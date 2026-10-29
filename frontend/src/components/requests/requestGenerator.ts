export type Scenario = "random" | "standard" | "rag";
export interface RequestPreview {
  sender_name: string;
  sender_email: string;
  subject: string;
  body: string;
}
interface Details {
  invoice: string;
  receipt: string;
  amount: number;
  expected: number;
  days: number;
  seats: number;
}
interface Template {
  id: string;
  label: string;
  scenario: Exclude<Scenario, "random">;
  subject: (d: Details) => string;
  message: (d: Details) => string;
}
export interface GeneratedRequest {
  templateId: string;
  label: string;
  scenario: Exclude<Scenario, "random">;
  preview: RequestPreview;
}
const firstNames = [
  "Alex",
  "Priya",
  "Jamie",
  "Aroha",
  "Sam",
  "Taylor",
  "Morgan",
  "Casey",
];
const lastNames = [
  "Wilson",
  "Patel",
  "Chen",
  "Thompson",
  "Morgan",
  "Reed",
  "Campbell",
  "Taylor",
];
// RAG questions target only the three fictional seeded documents. They contain
// customer circumstances and questions, never invented company commitments.
export const templates: Template[] = [
  {
    id: "invoice-error",
    label: "Invoice discrepancy",
    scenario: "standard",
    subject: (d) => `Incorrect amount on ${d.invoice}`,
    message: (d) =>
      `Our invoice ${d.invoice} shows NZD $${d.amount}, but our agreed amount was NZD $${d.expected}. Could you investigate the difference and let us know what happened?`,
  },
  {
    id: "login",
    label: "Login problem",
    scenario: "standard",
    subject: () => "Cannot sign in after resetting my password",
    message: () =>
      "I reset my password this morning, but the dashboard still shows an invalid credentials error. I have tried another browser with the same result. Could someone help me regain access?",
  },
  {
    id: "sales",
    label: "Sales enquiry",
    scenario: "standard",
    subject: (d) => `Pricing enquiry for ${d.seats} team members`,
    message: (d) =>
      `We are considering your service for a team of ${d.seats}. Could you share the available plans and pricing options? We are gathering information before making a decision next month.`,
  },
  {
    id: "technical",
    label: "Technical issue",
    scenario: "standard",
    subject: () => "Report export stops before completion",
    message: () =>
      "When I export our monthly report, the progress bar stops at 80% and no file downloads. I have retried twice. The rest of the dashboard works normally. Can you help investigate?",
  },
  {
    id: "duplicate-payment",
    label: "Duplicate payment",
    scenario: "standard",
    subject: (d) => `Possible duplicate payment for ${d.invoice}`,
    message: (d) =>
      `Our bank statement appears to show two payments of NZD $${d.amount} for invoice ${d.invoice}. Could you check whether the payment was recorded twice and advise on the next steps?`,
  },
  {
    id: "refund-within",
    label: "Refund within the standard window",
    scenario: "rag",
    subject: () => "Subscription refund eligibility",
    message: (d) =>
      `I purchased my subscription ${d.days} days ago and no longer need it. My receipt is ${d.receipt}. What does your refund policy say about eligibility, and what information will you need to verify my request?`,
  },
  {
    id: "refund-outside",
    label: "Refund outside the standard window",
    scenario: "rag",
    subject: () => "Refund request after 45 days",
    message: (d) =>
      `I purchased my subscription 45 days ago and would like a refund because our plans have changed. The service works normally and the payment was correct. Receipt: ${d.receipt}. Does this fall within your standard refund policy? Please explain the applicable window.`,
  },
  {
    id: "billing-policy",
    label: "Billing review procedure",
    scenario: "rag",
    subject: (d) => `Adjustment procedure for disputed invoice ${d.invoice}`,
    message: (d) =>
      `Invoice ${d.invoice} charged NZD $${d.amount} instead of the expected NZD $${d.expected}. Can an adjustment be made straight away, or does your billing policy require a review first? What supporting details should I provide?`,
  },
  {
    id: "outage-sla",
    label: "Critical outage escalation",
    scenario: "rag",
    subject: () => "Critical service outage — escalation process",
    message: () =>
      "Our entire team cannot access the service and work has stopped. Under your technical support SLA, how should a critical service outage be escalated? Please distinguish escalation from any promised resolution time.",
  },
  {
    id: "normal-sla",
    label: "Normal support response time",
    scenario: "rag",
    subject: () => "Expected response time for a normal support request",
    message: () =>
      "I have a non-critical question about the reporting screen. The service is otherwise working and nobody is blocked. What initial response time does your technical support SLA specify for a normal request?",
  },
];

export function generateRequest(
  scenario: Scenario,
  previousId?: string,
  random: () => number = Math.random,
): GeneratedRequest {
  const pick = <T>(items: readonly T[]) =>
    items[Math.floor(random() * items.length)];
  const number = (min: number, max: number) =>
    min + Math.floor(random() * (max - min + 1));
  const actual =
    scenario === "random" ? pick(["standard", "rag"] as const) : scenario;
  const available = templates.filter(
    (t) => t.scenario === actual && t.id !== previousId,
  );
  const template = pick(available);
  const first = pick(firstNames);
  const last = pick(lastNames);
  const expected = number(2, 15) * 50;
  const details: Details = {
    invoice: `INV-${new Date().getFullYear()}-${number(1000, 9999)}`,
    receipt: `ORD-DEMO-${number(10000, 99999)}`,
    amount: expected + number(1, 4) * 50,
    expected,
    days: number(2, 12),
    seats: number(3, 30),
  };
  const greeting = pick(["Hi team", "Hello", "Kia ora"]);
  const closing = pick(["Thanks for your help", "Kind regards", "Many thanks"]);
  return {
    templateId: template.id,
    label: template.label,
    scenario: actual,
    preview: {
      sender_name: `${first} ${last}`,
      sender_email: `${first.toLowerCase()}.${last.toLowerCase()}@example.com`,
      subject: template.subject(details),
      body: `${greeting},\n\n${template.message(details)}\n\n${closing},\n${first}`,
    },
  };
}
