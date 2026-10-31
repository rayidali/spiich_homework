"""Bounded JSON-lines adapter around the real Wren Rust semantic engine.

This process only plans SQL. The TypeScript evaluator executes successful plans
with its separately provisioned, workspace-scoped, read-only PostgreSQL role.
Neither database credentials nor a database connection enter this process.
"""

from __future__ import annotations

import base64
from datetime import date as calendar_date, timedelta
from decimal import Decimal
import hashlib
from importlib.metadata import version
import json
from pathlib import Path
import sys
import time

import sqlglot
from sqlglot import exp
from sqlglot.optimizer.scope import Scope, traverse_scope
import wren_core


CORE_VERSION = "0.8.2"
SQLGLOT_VERSION = "30.27.0"
MAX_INPUT_BYTES = 16_384
MAX_ROWS = 100
MODEL = "ledger"
PHYSICAL_SCHEMA = "research"
PHYSICAL_VIEW = "scoped_ledger"
FUNCTIONS = frozenset({
    "SUM", "COUNT", "MIN", "MAX", "AVG", "ROUND", "ABS", "COALESCE",
    "NULLIF", "CASE", "IF", "CAST", "LOWER", "UPPER", "TIMESTAMP_TRUNC",
    "DATE_TRUNC", "EXTRACT", "GREATEST", "LEAST", "AND", "OR",
})
CAST_TYPES = frozenset({
    "TEXT", "VARCHAR", "CHAR", "DATE", "TIMESTAMP", "TIMESTAMPTZ",
    "DECIMAL", "INT", "BIGINT", "SMALLINT", "BOOLEAN",
})
NATIVE_CURRENCIES = frozenset({"USD", "EUR", "GBP", "CAD", "JPY"})


class PolicyError(ValueError):
    """An untrusted plan exceeded the declared SQL language or resource budget."""


def column_units(ast: exp.Expression, expanded: exp.Expression | None = None) -> dict:
    """Derive numeric units from expressions, never names chosen by the model.

    This is deliberately narrower than the SQL planner. Unsupported lineage
    can execute, but its numeric output cannot be evidence for a typed claim.
    """
    simple_source = (
        isinstance(ast, exp.Select)
        and not ast.args.get("with_")
        and not list(ast.find_all(exp.Join))
        and not list(ast.find_all(exp.Subquery))
        and not any(alias.args.get("columns") for alias in ast.find_all(exp.TableAlias))
        and len(list(ast.find_all(exp.Table))) == 1
    )
    if not isinstance(ast, exp.Select):
        return {"columnUnits": {}, "unitProvenance": "ast-v1"}
    output = expanded if expanded is not None else ast
    if not isinstance(output, exp.Select) or len(output.expressions) != len(ast.expressions):
        return {"columnUnits": {}, "unitProvenance": "ast-v1"}

    def unalias(node):
        while isinstance(node, (exp.Alias, exp.Paren)):
            node = node.this
        return node

    def output_name(node):
        if node.alias:
            return node.alias
        node = unalias(node)
        if isinstance(node, exp.Column):
            return node.name
        if isinstance(node, (exp.Count, exp.Sum, exp.Avg, exp.Min, exp.Max, exp.Round, exp.Abs)):
            return node.sql_name().lower()
        return None

    def conjuncts(node):
        node = unalias(node)
        if isinstance(node, exp.And):
            return [*conjuncts(node.this), *conjuncts(node.expression)]
        return [node]

    currencies = set()
    where = ast.args.get("where")
    if simple_source and where:
        for predicate in conjuncts(where.this):
            if not isinstance(predicate, exp.EQ):
                continue
            left, right = predicate.this, predicate.expression
            if isinstance(left, exp.Literal):
                left, right = right, left
            if isinstance(left, exp.Column) and left.name.lower() == "currency" and isinstance(right, exp.Literal) and right.is_string and right.this in NATIVE_CURRENCIES:
                currencies.add(right.this)
    names = [output_name(node) for node in output.expressions]
    currency_columns = [names[index] for index, node in enumerate(ast.expressions) if isinstance(unalias(node), exp.Column) and unalias(node).name.lower() == "currency" and names[index] and names.count(names[index]) == 1]
    grouped = ast.args.get("group")
    grouped_currency = grouped and any(isinstance(unalias(node), exp.Column) and unalias(node).name.lower() == "currency" for node in grouped.expressions)
    needs_group = any(True for _ in ast.find_all(exp.AggFunc))
    native_currency = next(iter(currencies)) if len(currencies) == 1 and currency_columns and (not needs_group or grouped_currency) else None

    def common(units):
        effective = set(units) - {"zero"}
        return next(iter(effective)) if len(effective) == 1 else "zero" if not effective else "unsupported"

    def unit(node):
        if node is None or isinstance(node, exp.Null):
            return "zero"
        node = unalias(node)
        if isinstance(node, exp.Column):
            if not simple_source:
                return "unsupported"
            name = node.name.lower()
            if name in {"base_debit", "base_credit", "net_debit", "net_credit"}:
                return "USD"
            if name in {"debit", "credit"} and native_currency:
                return "native"
            return "unsupported"
        if isinstance(node, exp.Literal):
            if not node.is_number:
                return "unsupported"
            return "zero" if Decimal(node.this).is_zero() else "scalar"
        if isinstance(node, exp.Neg):
            return unit(node.this)
        if isinstance(node, exp.Count):
            return "count"
        if isinstance(node, exp.Cast):
            target = node.args.get("to")
            if isinstance(target, exp.DataType) and getattr(target.this, "name", None) in {"TEXT", "VARCHAR", "CHAR", "DECIMAL", "INT", "BIGINT", "SMALLINT"}:
                return unit(node.this)
            return "unsupported"
        if isinstance(node, (exp.Sum, exp.Avg, exp.Min, exp.Max, exp.Round, exp.Abs)):
            return unit(node.this)
        if isinstance(node, exp.Nullif):
            return unit(node.this)
        if isinstance(node, (exp.Coalesce, exp.Greatest, exp.Least)):
            return common([unit(node.this), *(unit(value) for value in node.expressions)])
        if isinstance(node, exp.Case):
            return common([unit(branch.args.get("true")) for branch in node.args.get("ifs", [])] + [unit(node.args.get("default"))])
        if isinstance(node, exp.If):
            return common([unit(node.args.get("true")), unit(node.args.get("false"))])
        if isinstance(node, (exp.Add, exp.Sub)):
            return common([unit(node.this), unit(node.expression)])
        if isinstance(node, exp.Mul):
            left, right = unit(node.this), unit(node.expression)
            if "unsupported" in {left, right}:
                return "unsupported"
            if left in {"scalar", "zero", "count"}:
                return right
            if right in {"scalar", "zero", "count"}:
                return left
            return "unsupported"
        if isinstance(node, exp.Div):
            left, right = unit(node.this), unit(node.expression)
            if "unsupported" in {left, right} or right == "zero":
                return "unsupported"
            if left == right and left in {"USD", "native", "count"}:
                return "count"
            if right in {"scalar", "count"}:
                return left
            return "unsupported"
        return "unsupported"

    columns = {}
    for expression, name in zip(ast.expressions, names):
        if not name or name in {"__proto__", "prototype", "constructor"}:
            continue
        value = unit(expression)
        if name in columns or value not in {"USD", "count", "native"}:
            value = "unsupported"
        columns[name] = value
    result = {"columnUnits": columns, "unitProvenance": "ast-v1"}
    if native_currency:
        result["nativeCurrency"] = native_currency
        result["currencyColumn"] = currency_columns[0]
    return result


def row_scope(ast: exp.Expression, expanded: exp.Expression | None = None) -> dict:
    """Prove row periods/identities for a deliberately small SQL subset.

    Null boundaries mean known unbounded history. Unsupported lineage is an
    explicit absence of proof, never a wildcard period or model-supplied scope.
    Per-row month/day clipping is performed by the shared TypeScript adapter.
    """
    unsupported = {"provenance": "ast-scope-v1", "supported": False}
    output = expanded if expanded is not None else ast
    if (
        not isinstance(ast, exp.Select) or not isinstance(output, exp.Select)
        or ast.args.get("with_") or ast.args.get("having")
        or ast.args.get("distinct")
        or len(list(ast.find_all(exp.Table))) != 1
        or len(output.expressions) != len(ast.expressions)
        or any(alias.args.get("columns") for alias in ast.find_all(exp.TableAlias))
        or any(isinstance(node, (exp.Join, exp.Subquery, exp.Or, exp.Not, exp.Case,
                                exp.If, exp.Filter, exp.Window)) for node in ast.walk())
    ):
        return unsupported

    def bare(node):
        while isinstance(node, (exp.Alias, exp.Paren)):
            node = node.this
        return node

    def column(node):
        node = bare(node)
        if isinstance(node, exp.Cast) and node.args["to"].this == exp.DataType.Type.DATE:
            inner = bare(node.this)
            if not isinstance(inner, exp.Column) or inner.name.lower() != "date":
                return None
            node = inner
        return node.name.lower() if isinstance(node, exp.Column) else None

    def date_value(node):
        node = bare(node)
        if isinstance(node, exp.Cast) and node.args["to"].this == exp.DataType.Type.DATE:
            node = bare(node.this)
        if not isinstance(node, exp.Literal) or not node.is_string:
            raise ValueError("Not a literal ISO date")
        value = calendar_date.fromisoformat(node.this)
        if value.isoformat() != node.this:
            raise ValueError("Not a canonical ISO date")
        return value

    def conjuncts(node):
        node = bare(node)
        return [*conjuncts(node.this), *conjuncts(node.expression)] if isinstance(node, exp.And) else [node]

    identity_keys = {"account_code": "accountCode", "account_name": "accountName",
                     "vendor": "vendor", "entry_id": "entryId"}
    physical_columns = {"organization_id", "entry_id", "date", "description", "vendor",
                        "account_code", "account_name", "account_type", "currency", "debit",
                        "credit", "base_debit", "base_credit", "exchange_rate", "status",
                        "is_cash", "net_debit", "net_credit"}
    fixed = {}
    lower = upper = None
    try:
        where = ast.args.get("where")
        for predicate in conjuncts(where.this) if where else []:
            # Date bounds must be actual conjunctive predicates, not words in a literal.
            date_columns = [c for c in predicate.find_all(exp.Column) if c.name.lower() == "date"]
            if date_columns:
                if isinstance(predicate, exp.Between) and column(predicate.this) == "date" and not predicate.args.get("symmetric"):
                    start = date_value(predicate.args["low"])
                    end = date_value(predicate.args["high"]) + timedelta(days=1)
                    lower = max(lower, start) if lower else start
                    upper = min(upper, end) if upper else end
                elif isinstance(predicate, (exp.EQ, exp.GT, exp.GTE, exp.LT, exp.LTE)):
                    left, right = predicate.this, predicate.expression
                    kind = type(predicate)
                    if column(left) != "date":
                        left, right = right, left
                        kind = {exp.GT: exp.LT, exp.GTE: exp.LTE, exp.LT: exp.GT,
                                exp.LTE: exp.GTE, exp.EQ: exp.EQ}[kind]
                    if column(left) != "date":
                        return unsupported
                    value = date_value(right)
                    if kind in {exp.EQ, exp.GT, exp.GTE}:
                        start = value + timedelta(days=1) if kind is exp.GT else value
                        lower = max(lower, start) if lower else start
                    if kind in {exp.EQ, exp.LT, exp.LTE}:
                        end = value if kind is exp.LT else value + timedelta(days=1)
                        upper = min(upper, end) if upper else end
                else:
                    return unsupported
            if isinstance(predicate, exp.EQ):
                left, right = bare(predicate.this), bare(predicate.expression)
                if isinstance(right, exp.Column):
                    left, right = right, left
                if isinstance(left, exp.Column) and isinstance(right, (exp.Literal, exp.Boolean)):
                    name = left.name.lower()
                    value = right.this
                    if name in fixed and fixed[name] != value:
                        return unsupported
                    fixed[name] = value
        if lower and upper and lower >= upper:
            return unsupported
    except (ValueError, OverflowError, KeyError):
        return unsupported

    def output_name(node):
        if node.alias:
            return node.alias
        node = bare(node)
        return node.name if isinstance(node, exp.Column) else node.output_name

    names = [output_name(node) for node in output.expressions]
    if any(not name or name in {"__proto__", "prototype", "constructor"} for name in names) or len(set(names)) != len(names):
        return unsupported

    def grain(node):
        node = bare(node)
        name = column(node)
        if name:
            return ("date",) if name == "date" else ("column", name)
        if isinstance(node, (exp.TimestampTrunc, exp.DateTrunc)):
            unit = node.args.get("unit")
            if not node.args.get("zone") and column(node.this) == "date" and unit and str(unit.this).upper() == "MONTH":
                return ("month",)
        return None

    # Resolve only unambiguous aliases: a real input column wins in PostgreSQL GROUP BY.
    aliases = {node.alias: bare(node) for node in ast.expressions if node.alias}
    groups = []
    group = ast.args.get("group")
    if group:
        if any(value for key, value in group.args.items() if key != "expressions"):
            return unsupported
        for expression in group.expressions:
            expression = bare(expression)
            if isinstance(expression, exp.Literal) and expression.is_int:
                index = int(expression.this) - 1
                if not 0 <= index < len(ast.expressions):
                    return unsupported
                expression = bare(ast.expressions[index])
            elif isinstance(expression, exp.Column) and not expression.table and expression.name.lower() not in physical_columns:
                expression = aliases.get(expression.name, expression)
            key = grain(expression)
            if key is None:
                return unsupported
            groups.append(key)
    aggregated = any(True for _ in ast.find_all(exp.AggFunc))
    period_columns = []
    identity_columns = {}
    projected_grains = set()
    for expression, name in zip(ast.expressions, names):
        key = grain(expression)
        if key is None:
            continue
        if aggregated and key not in groups:
            # Do not label an aggregate using a non-grouped projection.
            return unsupported
        if key[0] == "month" and key not in groups:
            return unsupported
        projected_grains.add(key)
        if key[0] in {"month", "date"}:
            period_columns.append({"name": name, "kind": key[0]})
        elif key[1] in identity_keys:
            field = identity_keys[key[1]]
            if field in identity_columns:
                return unsupported
            identity_columns[field] = name
    if len(period_columns) > 1:
        return unsupported
    if not aggregated and (
        not period_columns or period_columns[0]["kind"] != "date"
        or "entryId" not in identity_columns
    ):
        # An individual line selected before a cutoff is not a cumulative balance.
        # Raw money is only evidence for a dated, identified event; shared TS
        # narrows its bounds to that event day and forbids stock-asOf promotion.
        return unsupported
    for key in groups:
        if key[0] in {"month", "date"} or key[1] in identity_keys:
            if key not in projected_grains:
                return unsupported
        elif key[1] not in fixed:
            # Unsupported/hidden buckets cannot pretend to represent a whole period.
            return unsupported

    result = {"provenance": "ast-scope-v1", "supported": True,
              "from": lower.isoformat() if lower else None,
              "toExclusive": upper.isoformat() if upper else None}
    if period_columns:
        result["periodColumn"] = period_columns[0]
    if identity_columns:
        result["identityColumns"] = identity_columns
    fixed_identity = {identity_keys[name]: value for name, value in fixed.items()
                      if name in {"account_code", "account_name", "vendor"} and isinstance(value, str)}
    if fixed_identity:
        result["fixedIdentity"] = fixed_identity
    return result


def checked_ast(sql: str, *, planned: bool = False) -> exp.Expression:
    if not isinstance(sql, str) or not sql.strip() or len(sql.encode()) > MAX_INPUT_BYTES:
        raise PolicyError("SQL_SIZE")
    try:
        statements = sqlglot.parse(sql, read="postgres")
    except sqlglot.errors.ParseError as error:
        raise PolicyError("SQL_PARSE") from error
    if len(statements) != 1 or not isinstance(statements[0], (exp.Select, exp.Union)):
        raise PolicyError("SELECT_ONLY")
    ast = statements[0]
    nodes = list(ast.walk())
    if len(nodes) > (1_600 if planned else 500):
        raise PolicyError("SQL_COMPLEXITY")
    forbidden = (exp.DML, exp.DDL, exp.Command, exp.Into, exp.Lock, exp.Dot,
                 exp.Placeholder, exp.Parameter)
    for node in nodes:
        if isinstance(node, forbidden):
            raise PolicyError("SQL_OPERATION")
        if isinstance(node, exp.With) and node.args.get("recursive"):
            raise PolicyError("RECURSIVE_QUERY")
        if isinstance(node, exp.Func) and node.sql_name().upper() not in FUNCTIONS:
            raise PolicyError("FUNCTION_NOT_ALLOWED")
        if isinstance(node, exp.Cast):
            target = node.args.get("to")
            if not isinstance(target, exp.DataType) or getattr(target.this, "name", None) not in CAST_TYPES:
                raise PolicyError("CAST_NOT_ALLOWED")
        if isinstance(node, (exp.Limit, exp.Offset)):
            value = node.expression
            maximum = MAX_ROWS if isinstance(node, exp.Limit) else 1_000
            if not isinstance(value, exp.Literal) or not value.is_int or not 0 <= int(value.this) <= maximum:
                raise PolicyError("ROW_BUDGET")
        if isinstance(node, exp.Literal) and len(str(node.this)) > 1_000:
            raise PolicyError("LITERAL_BUDGET")
    if not planned and (len(list(ast.find_all(exp.Join))) > 2 or len(list(ast.find_all(exp.Select))) > 8):
        raise PolicyError("SQL_COMPLEXITY")
    has_approved_source = False
    for scope in traverse_scope(ast):
        for source in scope.sources.values():
            if isinstance(source, Scope):
                continue
            if not isinstance(source, exp.Table) or not isinstance(source.this, exp.Identifier):
                raise PolicyError("SOURCE_NOT_ALLOWED")
            if planned:
                permitted = source.name == PHYSICAL_VIEW and source.db == PHYSICAL_SCHEMA and not source.catalog
            else:
                permitted = source.name == MODEL and not source.db and not source.catalog
            if not permitted:
                raise PolicyError("SOURCE_NOT_ALLOWED")
            has_approved_source = True
    if not has_approved_source:
        raise PolicyError("MODEL_REQUIRED")
    # COUNT(*) is useful; bare SELECT * can return excessive/unreviewed columns.
    for star in ast.find_all(exp.Star):
        if not isinstance(star.parent, exp.Count):
            raise PolicyError("EXPLICIT_COLUMNS_REQUIRED")
    return ast


class Planner:
    def __init__(self) -> None:
        if version("wren-core-py") != CORE_VERSION or version("sqlglot") != SQLGLOT_VERSION:
            raise RuntimeError("PINNED_DEPENDENCIES_REQUIRED")
        manifest_bytes = Path(__file__).with_name("mdl.json").read_bytes()
        self.manifest_hash = hashlib.sha256(manifest_bytes).hexdigest()
        self.session = wren_core.SessionContext(
            base64.b64encode(manifest_bytes).decode(), None, None, "postgres"
        )

    def plan(self, sql: str) -> dict:
        start = time.perf_counter()
        ast = checked_ast(sql)
        # The returned SQL always has a bounded final result, including aggregates.
        if ast.args.get("limit") is None:
            ast = ast.limit(MAX_ROWS)
        canonical = ast.sql(dialect="postgres")
        # This is Wren's actual MDL expansion; never replace failures with custom SQL.
        expanded = self.session.transform_sql(canonical)
        expanded_ast = checked_ast(expanded, planned=True)
        return {
            "ok": True,
            "engine": "wren-core-py",
            "engineVersion": CORE_VERSION,
            "sqlglotVersion": SQLGLOT_VERSION,
            "plannedSql": expanded,
            "inputSha256": hashlib.sha256(sql.encode()).hexdigest(),
            "manifestSha256": self.manifest_hash,
            "planningMs": round((time.perf_counter() - start) * 1000, 3),
            "maxRows": MAX_ROWS,
            **column_units(ast, expanded_ast),
            "rowScope": row_scope(ast, expanded_ast),
        }


def main() -> int:
    try:
        planner = Planner()
    except Exception:
        print(json.dumps({"ok": False, "error": "WREN_UNAVAILABLE"}), flush=True)
        return 1
    # Bounded binary readline prevents an oversized line from allocating unbounded RAM.
    while line := sys.stdin.buffer.readline(MAX_INPUT_BYTES + 1):
        if len(line) > MAX_INPUT_BYTES:
            print(json.dumps({"ok": False, "error": "REQUEST_SIZE"}), flush=True)
            return 1
        request_id = None
        try:
            request = json.loads(line)
            if not isinstance(request, dict) or set(request) - {"id", "sql"}:
                raise PolicyError("REQUEST_SCHEMA")
            request_id = request.get("id")
            if request_id is not None and (not isinstance(request_id, str) or len(request_id) > 80):
                raise PolicyError("REQUEST_ID")
            result = planner.plan(request.get("sql"))
        except PolicyError as error:
            result = {"ok": False, "error": str(error)}
        except (json.JSONDecodeError, UnicodeDecodeError):
            result = {"ok": False, "error": "REQUEST_JSON"}
        except Exception:
            # Rust planner errors can contain the original query; do not echo raw errors.
            result = {"ok": False, "error": "WREN_PLANNING_FAILED"}
        result["id"] = request_id
        print(json.dumps(result, separators=(",", ":")), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
