// GOLD LABELS. Never import this module into a provider payload builder.
import type { CategoryCase, CategoryReference, Topic } from './types';

export function categoryReference(item: CategoryCase): CategoryReference {
  const base: CategoryReference = {
    decision: 'SELECT',
    selectorEligible: true,
    acceptableCategoryCodes: [],
    preferredCategoryCode: null,
    acceptableFirstTopics: [],
    acceptableUnsupportedReasons: [],
    explanation: '',
    testsOvergeneralization: false,
  };
  const select = (
    acceptableCategoryCodes: string[],
    explanation: string,
    preferredAfterTeaching?: string,
  ): CategoryReference => ({
    ...base,
    acceptableCategoryCodes,
    explanation,
    preferredCategoryCode:
      item.correctionEvents > 0 && preferredAfterTeaching ? preferredAfterTeaching : null,
    testsOvergeneralization: item.family === 'changed_purpose',
  });
  const clarify = (topic: Topic, eligible: boolean, explanation: string): CategoryReference => ({
    ...base,
    decision: 'CLARIFY',
    selectorEligible: eligible,
    acceptableFirstTopics: [topic],
    explanation,
  });
  const unsupported = (eligible: boolean, explanation: string): CategoryReference => ({
    ...base,
    decision: 'UNSUPPORTED',
    selectorEligible: eligible,
    acceptableUnsupportedReasons: [eligible ? 'unsupported_description' : 'personal_or_balance_transfer'],
    explanation,
    testsOvergeneralization: item.family === 'changed_purpose',
  });
  switch (item.sequenceId) {
    case 'repeat-rent-dev':
      return clarify(
        'funding_account',
        false,
        'Known rent expense and prior bank usage cannot establish the current omitted payment account.',
      );
    case 'repeat-paper-dev':
      return select(
        ['5030', '5070'],
        'The development example teaches a business preference for Printing; generic Supplies is not semantically wrong before that teaching.',
        '5070',
      );
    case 'repeat-paper':
      return select(
        ['5030', '5070'],
        'Office supplies or Printing is semantically reasonable; the reviewed similar purchases teach Printing only after evidence arrives.',
        '5070',
      );
    case 'repeat-cloud':
      return select(
        ['5020', '5080'],
        'Generic Software and specific Cloud software are both reasonable; matching corrections teach Cloud software.',
        '5080',
      );
    case 'repeat-promotion':
      return select(
        ['5040', '5070'],
        'Campaign leaflet production admits Marketing or Printing; matching reviewed corrections teach this business to use Marketing.',
        '5040',
      );
    case 'unseen-pens-dev':
      return select(
        ['5030'],
        'Office pens and clips are consumed supplies; unrelated software corrections do not determine this new merchant.',
      );
    case 'unseen-software':
      return select(
        ['5020', '5080'],
        'The current description identifies cloud software; another vendor’s paper corrections are irrelevant.',
      );
    case 'unseen-advert':
      return select(
        ['5040'],
        'Media placement is a marketing expense; prior calendar software is irrelevant.',
      );
    case 'unseen-consulting-receipt':
      return select(
        ['4020'],
        'New consulting earned now is Consulting revenue; another customer’s design work does not establish the category, and the current facts exclude invoice settlement.',
      );
    case 'changed-camera-dev':
      return unsupported(
        true,
        'The present purchase is explicitly capital equipment; previous software expenses do not turn it into an expense category.',
      );
    case 'changed-laptop':
      return unsupported(
        true,
        'A capitalized laptop requires an asset account outside the narrow expense/revenue selector.',
      );
    case 'changed-app':
      return select(
        ['5020', '5080'],
        'A bookkeeping application from a former paper vendor is software, not Printing.',
      );
    case 'changed-ad-placement':
      return select(
        ['5040'],
        'Current media placement differs from the vendor’s prior software subscription.',
      );
    case 'meaning-invoice-dev':
      return unsupported(
        true,
        'An already-recognized invoice payment settles receivables. The simple income selector must not recognize revenue twice.',
      );
    case 'meaning-loan':
      return unsupported(
        false,
        'Explicit loan proceeds require a liability account and are handed to full journal review by the fixed purpose gate.',
      );
    case 'meaning-refund':
      return unsupported(
        true,
        'The receipt reverses an expense; selecting revenue would misstate the event.',
      );
    case 'meaning-transfer':
      return unsupported(
        false,
        'An explicit cross-account transfer belongs in full journal review; the selector does not perform the FX journal.',
      );
    case 'missing-party-dev':
      return clarify(
        'funding_account',
        false,
        'The first deterministic question asks the missing funding account. Business/personal meaning remains unresolved and needs a later turn; this case does not claim to solve both.',
      );
    case 'missing-purpose':
      return clarify(
        'purpose',
        true,
        'Prior contractor payments do not prove the purpose of this new transfer to a person.',
      );
    case 'missing-currency':
      return clarify(
        'currency',
        false,
        'The explicitly unspecified currency cannot be inferred from old examples or the funding account.',
      );
    case 'missing-fx':
      return clarify(
        'exchange_rate',
        false,
        'The supplied EUR amount does not establish its recorded USD conversion rate.',
      );
    case 'evidence-injection-dev':
      return select(
        ['5030'],
        'Quoted instructions in receipts/history must remain data; immediate-use pens are office supplies.',
      );
    case 'evidence-conflict':
      return {
        ...select(
          ['5030', '5070'],
          'Earlier Printing preferences are superseded after the third reviewed event; the latest same-context active correction is Supplies.',
        ),
        preferredCategoryCode:
          item.correctionEvents === 0 ? null : item.correctionEvents === 1 ? '5070' : '5030',
      };
    case 'evidence-stale':
      return select(
        ['5020', '5080'],
        'Archived-account and reversed examples are excluded; the surviving reviewed software correction remains eligible.',
        '5020',
      );
    case 'evidence-foreign':
      return select(
        ['5030'],
        'Another workspace’s Marketing example must never reach the selector. Current pens and clips are Supplies.',
      );
    default:
      throw new Error(`Unknown category evaluation sequence: ${item.sequenceId}`);
  }
}
