/**
 * Terms of Service and Privacy Policy, as data.
 *
 * Drafted with the skills installed at .claude/skills:
 *  - legal-terms            — ToS section set, plain-English summary per clause, [VERIFY] tags
 *  - legal-privacy          — policy structure, legal-basis / retention / CCPA tables
 *  - direct-collection-notice — GDPR Art. 13(1)(a)-(f) and 13(2)(a)-(g) element coverage
 *  - retention-schedule     — Art. 5(1)(e) category / period / basis / trigger matrix
 *  - sub-processor-management — Art. 28(2) recipient disclosure and objection window
 *  - ccpa-cpra-compliance   — Cal. Civ. Code §1798.100-199 categories, rights, timelines
 *
 * NOT LEGAL ADVICE, and no attorney-client relationship arises from it. Every
 * assumption carries a [VERIFY] tag; every editable value lives in LEGAL and nowhere
 * else. Have counsel licensed in your jurisdiction review before publication.
 *
 * Factual basis: agent/src/capabilities.ts (integrations), agent/src/registry.ts and
 * agent/src/agent.ts (what is stored), agent/src/clerk.ts (authentication).
 */

export const LEGAL = {
  /** Registered entity. [VERIFY] */
  entity: "Salt Agents",
  /** Trading name. */
  product: "Salts",
  /** Registered office. Required for Art. 13(1)(a) and §1798.130 contact disclosure. */
  address: "[REGISTERED ADDRESS — VERIFY]",
  /** Governing law and forum. [VERIFY] */
  jurisdiction: "[GOVERNING JURISDICTION — VERIFY]",
  /** Supervisory authority a user complains to, per Art. 13(2)(d). */
  authority: "[LEAD SUPERVISORY AUTHORITY — VERIFY]",
  email: "legal@[DOMAIN]",
  privacyEmail: "privacy@[DOMAIN]",
  supportEmail: "support@[DOMAIN]",
  /** Art. 13(1)(b). Strike the line if no DPO is appointed under Art. 37. */
  dpo: "[DATA PROTECTION OFFICER — VERIFY, or not appointed]",
  site: "[DOMAIN]",
  updated: "22 September 2026",
  /** Art. 8 GDPR national age varies between 13 and 16; 16 is the default. [VERIFY] */
  minimumAge: 16,
  /** Art. 12(3): one month, extendable by two. */
  responseDays: 30,
  /** §1798.130(a)(2): 45 calendar days. */
  ccpaResponseDays: 45,
  /** Backup overwrite window quoted in the erasure clause. [VERIFY against provider] */
  backupDays: 30,
  /** Notice period for material changes, per the terms-generator guidance. */
  noticeDays: 30,
  /** Window to opt out of arbitration after first accepting these terms. */
  arbitrationOptOutDays: 30,
} as const;

export type LegalTable = {
  caption: string;
  head: string[];
  rows: string[][];
};

export type LegalSection = {
  heading: string;
  /** Plain-English summary shown above the clause text. */
  summary: string;
  /** Clause text. Rendered as numbered sub-clauses: 4.1, 4.2, and so on. */
  clauses: string[];
  list?: string[];
  table?: LegalTable;
};

export type LegalDoc = {
  title: string;
  intro: string;
  sections: LegalSection[];
};

const E = LEGAL.entity;
const P = LEGAL.product;

/* ----------------------------------------------------------------- Terms -- */

export const TERMS: LegalDoc = {
  title: "Terms of Service",
  intro: `These Terms of Service (the "Terms") govern access to and use of ${P}, operated by ${E} ("${E}", "we", "us"). Each clause is preceded by a plain-English summary. The summary is provided for convenience; the clause governs.`,
  sections: [
    {
      heading: "1. Acceptance of the Terms",
      summary: `Using ${P} means you accept these Terms. If you do not accept them, do not use the Service.`,
      clauses: [
        `By creating an Account, configuring an Agent, or sending a message to an Agent through any interface we operate, you agree to be bound by these Terms and by the Privacy Policy, which is incorporated into these Terms by reference.`,
        `You represent that you are at least ${LEGAL.minimumAge} years of age. Where you accept these Terms on behalf of an entity, you represent that you have authority to bind that entity, and "you" refers to that entity and to you jointly.`,
        `The current version of the Terms is published at ${LEGAL.site}/terms and is identified by the "Last updated" date at the head of this page.`,
      ],
    },
    {
      heading: "2. Definitions",
      summary: "The capitalised words used throughout these Terms mean the following.",
      clauses: ["In these Terms, the following definitions apply:"],
      list: [
        `"Account" means the record identified by the email address with which you authenticate to the Service.`,
        `"Agent" means an instance of the assistant you create within the Service, together with its configuration, sessions and stored content.`,
        `"Administrator" means the Account designated as administrator of an Agent, and "Authorised User" means any Account listed on that Agent's access list.`,
        `"Credentials" means an API key, bot token, server URL, header or other secret you supply so that a Capability can operate, including your OpenRouter API key and Telegram bot token.`,
        `"Input" means any message, instruction, file or other material submitted to an Agent, and "Output" means material an Agent generates in response.`,
        `"Model Provider" means the third party whose model generates an Output, reached on your behalf through OpenRouter.`,
        `"Connected Service" means any third-party service an Agent is configured to reach, including Telegram, search providers and MCP servers.`,
        `"Service" means ${P}, comprising the hosted application, its interfaces and its integrations, but excluding any Connected Service.`,
      ],
    },
    {
      heading: "3. The Service",
      summary:
        "We host the Agent and the interface around it. The model that writes the replies is a third party's, reached with your own API key.",
      clauses: [
        `The Service enables you to create, configure and operate an Agent, to converse with it through a browser and, where you connect a Telegram bot, through Telegram.`,
        `We do not operate a language model. Each Output is generated by a Model Provider selected by your configuration and reached through OpenRouter using your Credentials. The Model Provider's own terms and privacy policy govern its processing of the Input and its generation of the Output. We are not a party to that relationship and make no representation about any Model Provider.`,
        `The Service is provided on a best-efforts basis. We do not warrant continuous availability, and availability is in part determined by Connected Services outside our control.`,
        `Features designated as beta, preview or experimental may be changed or withdrawn at any time and are excluded from any commitment made elsewhere in these Terms.`,
      ],
    },
    {
      heading: "4. Accounts and access lists",
      summary:
        "You are responsible for your Account. Everyone on an Agent's access list can read its whole history and change its settings.",
      clauses: [
        `Accounts are created through our authentication provider and identified by an email address. You must provide accurate information and keep it current.`,
        `You are responsible for all activity conducted through your Account and for maintaining the confidentiality of your authentication credentials. You must notify us at ${LEGAL.supportEmail} promptly on becoming aware of unauthorised use.`,
        `Each Agent carries an access list. Every Authorised User on that list may read the Agent's entire message history, including Inputs submitted by other Authorised Users, may alter the Agent's configuration and may view its usage records. Adding an address to an access list constitutes your instruction to grant that access.`,
        `The Administrator may add or remove Authorised Users, including you, and may restrict which settings an Authorised User may change. Removal takes effect immediately and revokes further access to the Agent.`,
        `Accounts may not be shared. Each individual using the Service must hold an Account of their own.`,
      ],
    },
    {
      heading: "5. Credentials and third-party accounts",
      summary:
        "You bring your own keys and bot, you pay their charges, and you must keep to their terms.",
      clauses: [
        `Operation of an Agent requires Credentials issued to you by third parties. You represent that you are entitled to use each Credential you supply and that doing so does not breach the terms of the issuer.`,
        `All model charges are billed to your own OpenRouter account. We do not set, collect, control, refund or reimburse those charges, and any spending limit configured on that account is the only ceiling upon them. You are responsible for monitoring that spend.`,
        `A Telegram bot connected to an Agent remains subject to Telegram's terms of service. You are responsible for the conduct of that bot, including in any group or forum topic in which it is present, and for obtaining any consent required from the participants of that conversation.`,
        `You may remove any Credential from an Agent's settings at any time, which removes it from our storage. Removing a Credential does not revoke it at the issuer, and you remain responsible for revoking Credentials you no longer wish any party to hold.`,
      ],
    },
    {
      heading: "6. Acceptable use",
      summary: "Do not use an Agent to break the law, harm anyone, or abuse the infrastructure.",
      clauses: [
        `You shall not, and shall not permit any Authorised User or any person with access to a connected Telegram conversation to, use the Service to:`,
      ],
      list: [
        "violate any applicable law or regulation, or infringe the intellectual property, privacy, publicity or other rights of any person;",
        "generate, solicit or distribute material that sexually exploits or endangers minors, incites or threatens violence, or harasses, defames or discriminates against any person;",
        "impersonate any person or entity, or present an Output as having human authorship where that representation is deceptive;",
        "transmit unsolicited bulk communications, or operate an Agent in a Telegram group or channel without the consent of its administrator;",
        "upload or transmit malware, or material designed to interfere with the operation of any system;",
        "access, probe, scan or test the vulnerability of the Service, or circumvent any authentication, quota, rate limit or access control, whether of the Service or of a Connected Service, without our prior written consent;",
        "conduct prompt injection, jailbreaking or other adversarial testing against the Service without our prior written consent;",
        "scrape, crawl or extract data from the Service by automated means other than through an interface we provide for that purpose;",
        "resell, sublicense or provide the Service to a third party as a service of your own, or use the Service to develop a competing product.",
      ],
    },
    {
      heading: "7. Content, licence and Output",
      summary:
        "Your Inputs stay yours. Output is yours as between us. Output is machine-generated, so verify it.",
      clauses: [
        `As between you and us, you retain all right, title and interest in your Inputs. You grant us a worldwide, non-exclusive, royalty-free licence to host, store, reproduce, transmit and process your Inputs and Outputs solely to the extent necessary to operate the Service for you, including transmission to the Model Providers and Connected Services your configuration specifies. This licence terminates when you delete the material or the Agent that holds it.`,
        `You represent that you hold the rights necessary to submit each Input and that its submission and processing does not breach any obligation owed to a third party.`,
        `As between you and us, you own the Outputs generated for you, subject to the terms of the applicable Model Provider. Outputs are generated probabilistically, and identical or similar Outputs may be generated for other users. We make no claim to exclusivity in any Output.`,
        `We do not use your Inputs or Outputs to train models. Model Providers may do so under their own terms; where that matters to you, select a Model Provider whose terms prohibit it.`,
        `OUTPUTS MAY BE INACCURATE, INCOMPLETE OR FABRICATED, AND DO NOT CONSTITUTE LEGAL, MEDICAL, FINANCIAL OR OTHER PROFESSIONAL ADVICE. You are solely responsible for evaluating an Output before relying upon it and for any action an Agent takes on your instruction, including tool calls, scheduled tasks and messages it sends.`,
        `We may remove content that we reasonably believe breaches clause 6, and may use automated means to detect material we are legally obliged to act upon.`,
      ],
    },
    {
      heading: "8. Fees",
      summary: "We charge nothing. Third parties charge you directly, and we refund nothing.",
      clauses: [
        `The Service is currently provided at no charge. We reserve the right to introduce fees, in which case we will give notice under clause 14 and no fee will apply to a period before it takes effect.`,
        `Charges levied by OpenRouter, a Model Provider, a search provider or any other Connected Service are payable by you directly to that party under your agreement with it. No refund is available from us in respect of those charges.`,
      ],
    },
    {
      heading: "9. Service limits and changes",
      summary: "There are usage limits, and features can change. Self-host if the limits do not suit you.",
      clauses: [
        `We may impose and vary usage limits, including limits on the number of chat sessions an Agent retains, the size of an upload and the rate of requests. Where an Agent exceeds a session limit, older sessions must be deleted before new ones are created.`,
        `We may add, modify, suspend or discontinue any feature. Where a change materially reduces the functionality of the Service, we will use reasonable efforts to give notice under clause 14.`,
        `The Service may be deployed by you on infrastructure you control. A deployment you operate is not the Service, is not covered by these Terms, and is your responsibility including as to security, availability and compliance.`,
      ],
    },
    {
      heading: "10. Suspension and termination",
      summary: "Leave whenever you like. We can suspend an Account that breaches these Terms.",
      clauses: [
        `You may terminate these Terms at any time by ceasing use of the Service and deleting your Agents. Deleting an Agent deletes its configuration, Credentials, sessions, messages, attachments and memories.`,
        `We may suspend or terminate access to the Service, in whole or in part, where we reasonably believe that you have breached these Terms, that continued access presents a risk to the Service or to another user, or that suspension is required by law. Where the breach is capable of remedy and suspension is not urgent, we will give notice and a reasonable opportunity to remedy it.`,
        `On termination, your right to use the Service ceases immediately. Content remaining in an Agent is deleted in accordance with the Privacy Policy.`,
        `Clauses 2, 5.2, 7, 8.2, 10.4, 11, 12, 13, 15, 16 and 17 survive termination of these Terms.`,
      ],
    },
    {
      heading: "11. Intellectual property",
      summary: "Our software, name and marks remain ours; you get a limited licence to use them.",
      clauses: [
        `The Service, and all software, interfaces, documentation, designs and marks comprised in it, are owned by ${E} or its licensors and are protected by intellectual property laws. Subject to these Terms, we grant you a limited, revocable, non-exclusive, non-transferable licence to access and use the Service for your internal purposes.`,
        `You shall not copy, modify, reverse engineer, decompile or create derivative works of the Service, except to the extent that restriction is prohibited by applicable law or permitted by the licence of an open-source component included in it.`,
        `You shall not use our name or marks without prior written consent, other than to identify the Service factually.`,
        `You grant us a perpetual, irrevocable, royalty-free licence to use feedback and suggestions you provide, without obligation or attribution.`,
      ],
    },
    {
      heading: "12. Privacy and data protection",
      summary:
        "The Privacy Policy explains what we process. If other people message your Agent, you are the controller of what they send.",
      clauses: [
        `Our processing of personal data in operating the Service is described in the Privacy Policy, which forms part of these Terms.`,
        `Where you configure an Agent that receives Inputs from individuals other than yourself, including participants in a Telegram group, you are the controller of that personal data and we process it on your documented instructions as your processor within the meaning of Article 4(8) GDPR. You are responsible for establishing a lawful basis for that processing and for providing those individuals with the information required by Articles 13 and 14 GDPR.`,
        `You instruct us to engage the sub-processors listed in the Privacy Policy, and authorise their engagement generally under Article 28(2) GDPR, subject to the notification and objection procedure described there.`,
        `Where you require a data processing agreement incorporating the Article 28(3) terms, contact ${LEGAL.privacyEmail}.`,
      ],
    },
    {
      heading: "13. Disclaimers",
      summary: "The Service is provided as it is, with no warranties.",
      clauses: [
        `THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTY OF ANY KIND. TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE DISCLAIM ALL WARRANTIES, EXPRESS, IMPLIED OR STATUTORY, INCLUDING THE IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, ACCURACY AND NON-INFRINGEMENT.`,
        `WE DO NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, TIMELY, SECURE OR ERROR-FREE, THAT ANY OUTPUT WILL BE ACCURATE OR SUITABLE FOR YOUR PURPOSE, OR THAT ANY CONNECTED SERVICE OR MODEL PROVIDER WILL CONTINUE TO BE AVAILABLE OR TO BEHAVE CONSISTENTLY.`,
        `Neither party is liable for any failure or delay in performance caused by an event beyond its reasonable control, including acts of God, natural disaster, epidemic, war, civil unrest, labour dispute, act of government, failure of a telecommunications or hosting provider, and denial-of-service or other malicious attack.`,
        `Some jurisdictions do not allow the exclusion of implied warranties or of consumer rights. Nothing in this clause limits a right you hold that cannot lawfully be excluded.`,
      ],
    },
    {
      heading: "14. Limitation of liability",
      summary:
        "No liability for indirect loss, and our total liability is capped at what you paid us or USD 100, whichever is greater.",
      clauses: [
        `TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY OR PUNITIVE DAMAGES, OR FOR ANY LOSS OF PROFITS, REVENUE, DATA, BUSINESS OR GOODWILL, WHETHER IN CONTRACT, TORT OR OTHERWISE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.`,
        `OUR TOTAL AGGREGATE LIABILITY ARISING OUT OF OR RELATING TO THE SERVICE OR THESE TERMS SHALL NOT EXCEED THE GREATER OF (A) THE AMOUNT YOU PAID US IN THE TWELVE MONTHS PRECEDING THE EVENT GIVING RISE TO THE CLAIM, AND (B) USD 100. BECAUSE THE SERVICE IS PROVIDED AT NO CHARGE, LIMB (A) IS ORDINARILY NIL.`,
        `We are not liable for charges incurred on your OpenRouter account or with any other Connected Service, including charges resulting from configuration you chose or from use of your Credentials by a person you granted access.`,
        `Nothing in these Terms excludes or limits liability for death or personal injury caused by negligence, for fraud or fraudulent misrepresentation, or for any other liability that cannot lawfully be excluded.`,
      ],
    },
    {
      heading: "15. Indemnification",
      summary: "If a third party sues us over your use of the Service, you cover the cost.",
      clauses: [
        `You shall indemnify and hold harmless ${E}, its officers, employees and agents against any third-party claim, and against damages, liabilities and reasonable legal costs finally awarded or agreed in settlement, arising out of or relating to your use of the Service, your Inputs, your Credentials, your operation of an Agent in a conversation involving other individuals, or your breach of these Terms or of any applicable law.`,
        `We shall notify you promptly of any claim to which this clause applies, and may assume its defence with counsel of our choosing at your expense. You shall not settle any claim in a manner that imposes an obligation on us without our prior written consent.`,
      ],
    },
    {
      heading: "16. Governing law and dispute resolution",
      summary: `${LEGAL.jurisdiction} law governs. Contact us first; arbitration follows, and you may opt out within ${LEGAL.arbitrationOptOutDays} days.`,
      clauses: [
        `These Terms and any dispute arising out of them are governed by the laws of ${LEGAL.jurisdiction}, without regard to conflict-of-laws principles, and subject to any mandatory law of your country of residence that cannot be excluded by agreement.`,
        `Before commencing proceedings, the parties shall attempt informal resolution. You shall send a written notice describing the dispute to ${LEGAL.email} and allow thirty (30) days from receipt for resolution.`,
        `[VERIFY — arbitration is optional and unenforceable against consumers in several jurisdictions.] If the dispute is not resolved informally, it shall be determined by binding individual arbitration administered by [ARBITRATION PROVIDER — VERIFY] under its then-current rules, seated in ${LEGAL.jurisdiction}. YOU AND ${E.toUpperCase()} AGREE THAT EACH MAY BRING CLAIMS AGAINST THE OTHER ONLY IN AN INDIVIDUAL CAPACITY, AND NOT AS A PLAINTIFF OR CLASS MEMBER IN ANY PURPORTED CLASS OR REPRESENTATIVE PROCEEDING.`,
        `You may opt out of clause 16.3 by sending written notice to ${LEGAL.email} within ${LEGAL.arbitrationOptOutDays} days of first accepting these Terms. Opting out does not affect any other provision. Either party may bring an individual claim in a small-claims court of competent jurisdiction, and either party may seek injunctive relief in respect of intellectual property or unauthorised access.`,
        `Where clause 16.3 does not apply, the courts of ${LEGAL.jurisdiction} have exclusive jurisdiction, save that a consumer may bring proceedings in the courts of their place of residence.`,
      ],
    },
    {
      heading: "17. Changes to the Terms",
      summary: `We may amend these Terms on ${LEGAL.noticeDays} days' notice for material changes.`,
      clauses: [
        `We may amend these Terms. A material amendment takes effect no earlier than ${LEGAL.noticeDays} days after we publish the amended Terms and notify you within the Service or by email to the address on your Account. A non-material amendment takes effect on publication.`,
        `Continued use of the Service after an amendment takes effect constitutes acceptance of it. If you do not accept an amendment, you must stop using the Service and may delete your Account before it takes effect.`,
      ],
    },
    {
      heading: "18. General provisions",
      summary: "The usual boilerplate: notices, assignment, severability, and the whole agreement.",
      clauses: [
        `These Terms and the Privacy Policy constitute the entire agreement between the parties in respect of the Service and supersede all prior understandings relating to it.`,
        `If any provision is held invalid or unenforceable, it shall be modified to the minimum extent necessary to make it enforceable, or severed, and the remaining provisions shall continue in full force.`,
        `No failure or delay in exercising a right constitutes a waiver of it, and no waiver is effective unless in writing.`,
        `You may not assign or transfer these Terms without our prior written consent. We may assign them to an affiliate or in connection with a merger, acquisition or sale of substantially all of our assets.`,
        `Nothing in these Terms creates a partnership, agency, joint venture or employment relationship between the parties.`,
        `Notices to you may be given by email to the address on your Account or by posting within the Service. Formal notices to us must be sent to ${LEGAL.email} and to ${E}, ${LEGAL.address}. You consent to receive communications from us electronically.`,
        `Model Providers are intended third-party beneficiaries of clauses 5, 6 and 7 to the extent those clauses govern your use of their models. No other person has any right to enforce these Terms.`,
        `Headings are for convenience only and do not affect interpretation.`,
      ],
    },
    {
      heading: "19. Contact",
      summary: "Where to reach us.",
      clauses: [
        `${E}, ${LEGAL.address}.`,
        `Legal notices: ${LEGAL.email}. Support: ${LEGAL.supportEmail}. Privacy and data-rights requests: ${LEGAL.privacyEmail}.`,
      ],
    },
  ],
};

/* --------------------------------------------------------------- Privacy -- */

export const PRIVACY: LegalDoc = {
  title: "Privacy Policy",
  intro: `This Privacy Policy explains how ${E} processes personal data in operating ${P}. It is issued under Articles 13 and 14 of the General Data Protection Regulation (EU) 2016/679 ("GDPR"), and section 12 sets out the additional disclosures required of a business by the California Consumer Privacy Act as amended by the CPRA (Cal. Civ. Code §1798.100-199).`,
  sections: [
    {
      heading: "1. Controller and contact details",
      summary: "We are responsible for the data described here. These are the addresses to use.",
      clauses: [
        `The controller for the processing described in this Policy is ${E}, ${LEGAL.address} (Art. 13(1)(a) GDPR).`,
        `Our data protection officer may be contacted at ${LEGAL.dpo} (Art. 13(1)(b) GDPR).`,
        `Requests under this Policy, including data subject requests, should be sent to ${LEGAL.privacyEmail}.`,
      ],
    },
    {
      heading: "2. Scope and your own controllership",
      summary:
        "This Policy covers the service we run. Where other people message your Agent, you are the controller and we act for you.",
      clauses: [
        `This Policy applies to the hosted service we operate at ${LEGAL.site}. It does not apply to a deployment you host yourself, nor to any Connected Service, each of which publishes its own policy.`,
        `Where you create an Agent that receives messages from individuals other than yourself, you determine the purposes and means of that processing. You are the controller of that content and we act as your processor under Article 28 GDPR, processing it only on your documented instructions. The obligation to inform those individuals under Articles 13 and 14 GDPR rests with you.`,
      ],
    },
    {
      heading: "3. Categories of personal data processed",
      summary: "Your email, your Agent's settings and keys, everything sent to the Agent, and what each reply cost.",
      clauses: [
        `We process the categories of personal data set out below. Personal data is obtained directly from you, except where the source column states otherwise (Art. 13 and Art. 14(2)(f) GDPR).`,
        `Provision of account data and of the Credentials an Agent requires is a contractual requirement: without them we cannot create an Account or operate an Agent, and the Service cannot be provided (Art. 13(2)(e) GDPR).`,
      ],
      table: {
        caption: "Data categories, examples and source",
        head: ["Category", "Data", "Source"],
        rows: [
          [
            "Account data",
            "Email address, authentication identifiers and session metadata; the access list and administrator of each Agent",
            "You; our authentication provider",
          ],
          [
            "Agent configuration",
            "Agent name, selected model, system prompt, tuning parameters, enabled capabilities",
            "You",
          ],
          [
            "Credentials",
            "OpenRouter API key, Telegram bot token and username, search API key, MCP server URLs and headers",
            "You",
          ],
          [
            "Conversation content",
            "Messages, attachments (documents, images, audio), text extracted from attachments, and facts saved to memory where that capability is enabled",
            "You and anyone you permit to message the Agent",
          ],
          [
            "Telegram data",
            "Chat, user and forum-topic identifiers, usernames, and the whitelists you configure",
            "Telegram, on receipt of a message",
          ],
          [
            "Usage records",
            "Tokens consumed, cost in USD, latency and timestamp per reply",
            "Generated by the Service",
          ],
          [
            "Technical data",
            "IP address, request metadata, error diagnostics and security logs",
            "Generated automatically on each request",
          ],
        ],
      },
    },
    {
      heading: "4. Purposes and legal bases",
      summary: "Each purpose and the GDPR ground we rely on for it.",
      clauses: [
        `We process personal data for the purposes and on the legal bases set out below (Art. 13(1)(c) GDPR). Where we rely on Article 6(1)(f), the legitimate interest pursued is stated (Art. 13(1)(d) GDPR).`,
        `We do not sell personal data, do not use conversation content for advertising or profiling, and do not use it to train models of our own.`,
      ],
      table: {
        caption: "Processing purposes and legal bases",
        head: ["Purpose", "Data", "Legal basis"],
        rows: [
          [
            "Creating and authenticating an Account",
            "Account data",
            "Art. 6(1)(b) — performance of a contract",
          ],
          [
            "Operating an Agent: storing conversations, routing model calls, delivering Telegram messages, running enabled capabilities",
            "Agent configuration, Credentials, conversation content, Telegram data",
            "Art. 6(1)(b) — performance of a contract",
          ],
          [
            "Showing what each reply cost",
            "Usage records",
            "Art. 6(1)(b) — performance of a contract",
          ],
          [
            "Maintaining security and availability, preventing abuse, diagnosing faults",
            "Technical data, usage records",
            "Art. 6(1)(f) — legitimate interest in operating a secure and functioning service",
          ],
          [
            "Responding to requests and enquiries",
            "Account data, correspondence",
            "Art. 6(1)(b) and Art. 6(1)(f) — legitimate interest in responding",
          ],
          [
            "Complying with legal obligations and responding to lawful requests",
            "Any of the above",
            "Art. 6(1)(c) — legal obligation",
          ],
        ],
      },
    },
    {
      heading: "5. Recipients and sub-processors",
      summary: "Cloudflare hosts it, Clerk signs you in, OpenRouter routes the model call, Telegram carries the chat.",
      clauses: [
        `We disclose personal data to the categories of recipient listed below (Art. 13(1)(e) GDPR). Each processor acts under a written contract incorporating the terms required by Article 28(3) GDPR.`,
        `You authorise these sub-processors generally under Article 28(2) GDPR. We will give notice within the Service or by email before adding or replacing a sub-processor, and you may object by writing to ${LEGAL.privacyEmail} within ${LEGAL.noticeDays} days; where an objection cannot be accommodated, you may terminate by deleting the affected Agent.`,
        `Content sent to a Model Provider or a Connected Service is processed by that party under its own terms. Some Model Providers use inputs and outputs to improve their models; where that matters to you, select a provider whose terms exclude it. An MCP server you connect is a third party of your choosing, which we do not vet.`,
        `We may also disclose personal data where required by law, court order or a binding request from a competent authority, and to a successor entity in connection with a merger, acquisition or sale of assets, in which case we will notify you.`,
      ],
      table: {
        caption: "Sub-processors and recipients",
        head: ["Recipient", "Purpose", "Location [VERIFY]"],
        rows: [
          ["Cloudflare, Inc.", "Hosting, storage, network and edge compute", "United States; global edge"],
          ["Clerk, Inc.", "Authentication and session management", "United States"],
          [
            "OpenRouter, Inc.",
            "Routing each model call to the Model Provider you selected, under your own API key",
            "United States",
          ],
          [
            "Model Providers",
            "Generating the Output for a call routed by OpenRouter; identity depends on the model you select",
            "Varies by provider",
          ],
          ["Telegram Messenger Inc.", "Delivering messages to and from a bot you connect", "Varies; see Telegram's policy"],
          [
            "Brave Software, Inc., or a SearXNG instance you nominate",
            "Executing a web search where that capability is enabled",
            "United States; or as you configure",
          ],
          [
            "MCP servers you connect",
            "Executing tool calls you have configured; recipient and location determined by you",
            "As you configure",
          ],
        ],
      },
    },
    {
      heading: "6. Credentials",
      summary: "Keys are stored so the Agent can use them, never displayed back to you, and removable at any time.",
      clauses: [
        `Credentials must be usable at the time of a call and are therefore stored in recoverable form rather than as a one-way hash. They are held with the configuration of the Agent they belong to, are never returned in full to a browser — the settings interface displays a mask — and are removed from storage when the field is cleared or the Agent is deleted.`,
        `Removal from our storage does not revoke a Credential at its issuer. We recommend scoping each Credential narrowly, setting a spending limit on your OpenRouter account, and rotating any Credential you believe may be compromised.`,
      ],
    },
    {
      heading: "7. International transfers",
      summary: "Data leaves your country, because our providers and the model providers are global.",
      clauses: [
        `Personal data is transferred to, and processed in, countries outside the European Economic Area and the United Kingdom, including the United States (Art. 13(1)(f) GDPR).`,
        `Where a transfer is made to a country not covered by an adequacy decision of the European Commission under Article 45 GDPR, we rely on the standard contractual clauses adopted by the Commission under Article 46(2)(c) GDPR, supplemented where necessary by additional technical and organisational measures. A copy of the safeguards applying to a given recipient is available on request to ${LEGAL.privacyEmail}.`,
        `A transfer to a Connected Service you configure, including an MCP server, is made on your instruction and under the transfer mechanism, if any, of that provider.`,
      ],
    },
    {
      heading: "8. Retention",
      summary: "We keep things until you delete them; deleting an Agent deletes its contents.",
      clauses: [
        `Personal data is retained in accordance with the schedule below and thereafter deleted or irreversibly anonymised (Art. 5(1)(e) and Art. 13(2)(a) GDPR).`,
        `Deleting a session deletes its messages, attachments and usage records. Deleting an Agent deletes its configuration, Credentials, sessions and memories. Deleting your Account deletes the Agents you administer.`,
        `Following deletion, residual copies may persist in encrypted backups and in provider logs until overwritten in the ordinary cycle, which is up to ${LEGAL.backupDays} days [VERIFY against provider commitments]. Data we are required to retain for a legal purpose is retained for the period of that requirement and processed for no other purpose.`,
      ],
      table: {
        caption: "Retention schedule",
        head: ["Category", "Retention period", "Trigger"],
        rows: [
          ["Account data", "Life of the Account", "Account deletion"],
          ["Agent configuration and Credentials", "Life of the Agent, or until the field is cleared", "Agent deletion"],
          ["Conversation content and attachments", "Until the session or Agent is deleted; no automatic expiry", "Session or Agent deletion"],
          ["Memories", "Until deleted by you or the Agent is deleted", "Agent deletion"],
          ["Usage records", "Life of the session", "Session deletion"],
          ["Technical and security logs", "[VERIFY — provider default, typically 30 days]", "Elapse of the retention window"],
          ["Backups", `Up to ${LEGAL.backupDays} days after deletion`, "Backup rotation"],
        ],
      },
    },
    {
      heading: "9. Security",
      summary: "Encryption in transit, per-Agent isolation, and access checked on every request.",
      clauses: [
        `We implement technical and organisational measures appropriate to the risk, as required by Article 32 GDPR, including encryption of personal data in transit, isolation of each Agent's storage, authentication of every request against a cryptographically signed session token, and authorisation against the Agent's access list, which is held separately from the configuration it governs.`,
        `No system is perfectly secure. Where a personal data breach occurs, we will notify the competent supervisory authority in accordance with Article 33 GDPR and affected individuals in accordance with Article 34 GDPR where the thresholds are met.`,
      ],
    },
    {
      heading: "10. Your rights",
      summary: `Access, rectification, erasure, restriction, portability, objection. Email us; we answer within ${LEGAL.responseDays} days.`,
      clauses: [
        `Subject to the conditions in the GDPR, you have the right to request access to your personal data (Art. 15), its rectification (Art. 16), its erasure (Art. 17), restriction of processing (Art. 18) and portability of data you provided to us (Art. 20), and to object to processing based on Article 6(1)(f) (Art. 21). We extend these rights to all users as a matter of policy, wherever they reside.`,
        `Where processing is based on consent, you may withdraw it at any time without affecting the lawfulness of processing carried out before withdrawal (Art. 13(2)(c) GDPR).`,
        `Many of these rights are exercisable directly: settings display and amend your configuration, sessions may be exported and deleted, and deleting an Agent erases its contents. For anything else, write to ${LEGAL.privacyEmail}. We respond within one month of receipt and may extend that period by two further months where the request is complex, notifying you of the extension and its reasons (Art. 12(3) GDPR).`,
        `You have the right to lodge a complaint with a supervisory authority, in particular in the Member State of your habitual residence, place of work or place of the alleged infringement (Art. 13(2)(d) and Art. 77 GDPR). Our lead supervisory authority is ${LEGAL.authority}.`,
        `We do not carry out automated decision-making producing legal or similarly significant effects, or profiling, within the meaning of Article 22 GDPR. An Output is generated automatically but produces no decision of that character; what you do with it is your own decision (Art. 13(2)(f) GDPR).`,
        `We do not process personal data for any purpose other than those stated in section 4. Should we intend to do so, we will inform you beforehand and provide the information required by Article 13(3) GDPR.`,
      ],
    },
    {
      heading: "11. Cookies and local storage",
      summary: "Only what is needed to sign you in and remember your interface settings.",
      clauses: [
        `We use strictly necessary cookies and equivalent browser storage. We do not set advertising cookies, do not operate cross-site tracking, and do not run third-party analytics that profile you. No consent banner is required for strictly necessary storage under Article 5(3) of Directive 2002/58/EC.`,
      ],
      table: {
        caption: "Cookies and equivalent storage",
        head: ["Type", "Purpose", "Duration"],
        rows: [
          ["Authentication", "Maintains your signed-in session", "Session, and as set by our authentication provider"],
          ["Security", "CSRF protection and abuse prevention", "Session"],
          ["Preferences", "Remembers interface settings such as the last Agent opened", "Local storage, until cleared"],
        ],
      },
    },
    {
      heading: "12. California residents",
      summary: "We collect the categories below, sell nothing, share nothing for advertising, and will not penalise you for asking.",
      clauses: [
        `This section applies to California residents and supplements the rest of this Policy. Terms used have the meanings given in Cal. Civ. Code §1798.140.`,
        `In the twelve months preceding the date of this Policy we collected the categories of personal information set out below, for the business purposes described in section 4, from the sources described in section 3, and disclosed them for a business purpose to the recipients listed in section 5.`,
        `We do not sell personal information (§1798.140(ad)) and do not share it for cross-context behavioural advertising (§1798.140(ah)). We have not done so in the preceding twelve months, including in respect of consumers under 16 years of age. No "Do Not Sell or Share My Personal Information" link is therefore required.`,
        `We collect the contents of your communications with an Agent, which constitutes sensitive personal information under §1798.140(ae)(1)(D). We use it solely to provide the Service you requested, which is a permitted purpose under §1798.121(a), and we do not use or disclose it to infer characteristics about you.`,
        `You have the right to know (§§1798.100, 1798.110, 1798.115), to delete (§1798.105), to correct (§1798.106), to limit the use of sensitive personal information (§1798.121), to opt out of sale or sharing (§1798.120) and to non-discrimination for exercising any of them (§1798.125). Submit a request to ${LEGAL.privacyEmail}; we confirm receipt within 10 business days and respond within ${LEGAL.ccpaResponseDays} calendar days, extendable once by a further 45 days where reasonably necessary.`,
        `An authorised agent may submit a request on your behalf with written permission signed by you, and we may require you to verify your identity directly. We verify requests by reference to control of the email address on the Account.`,
      ],
      table: {
        caption: "Categories collected in the preceding 12 months (§1798.140(v))",
        head: ["Statutory category", "Collected", "Examples"],
        rows: [
          ["Identifiers", "Yes", "Email address, account identifier, IP address"],
          ["Commercial information", "No", "—"],
          ["Biometric information", "No", "—"],
          ["Internet or other electronic network activity", "Yes", "Request metadata, feature usage, error logs"],
          ["Geolocation data", "No", "Precise geolocation is not collected; IP address may imply coarse region"],
          ["Audio, electronic, visual or similar information", "Yes", "Voice notes and images you attach to a message"],
          ["Professional or employment information", "No", "Only where you choose to put it in a message"],
          ["Education information", "No", "—"],
          ["Inferences", "No", "We draw no profile from your data"],
          [
            "Sensitive personal information",
            "Yes",
            "Contents of your communications with an Agent (§1798.140(ae)(1)(D)); account credentials held by our authentication provider",
          ],
        ],
      },
    },
    {
      heading: "13. Children",
      summary: `The Service is not for anyone under ${LEGAL.minimumAge}.`,
      clauses: [
        `The Service is not directed at children and may not be used by anyone under ${LEGAL.minimumAge} years of age [VERIFY against the age set under Art. 8(1) GDPR in your Member State, which may be as low as 13]. We do not knowingly collect personal data from children under that age.`,
        `Where you operate an Agent in a conversation that may include children, you are responsible as controller for any consent required. If you believe a child's personal data has reached us, write to ${LEGAL.privacyEmail} and we will delete it without undue delay.`,
      ],
    },
    {
      heading: "14. Self-hosted deployments",
      summary: "Host it yourself and this Policy does not apply — you become the controller.",
      clauses: [
        `${P} may be deployed on infrastructure you control. In that case personal data does not reach our systems, we are neither controller nor processor in respect of it, and this Policy does not apply. The providers listed in section 5 continue to process data under the accounts you configure, and you are the controller in respect of that processing.`,
      ],
    },
    {
      heading: "15. Changes to this Policy",
      summary: "We date each version and tell you when a change is material.",
      clauses: [
        `We may amend this Policy. The "Last updated" date identifies the current version. Where an amendment materially affects the processing of your personal data, we will notify you within the Service or by email before it takes effect.`,
      ],
    },
    {
      heading: "16. Contact and complaints",
      summary: "Where to write, and who to complain to if we get it wrong.",
      clauses: [
        `${E}, ${LEGAL.address}. Data protection officer: ${LEGAL.dpo}.`,
        `Privacy and data subject requests: ${LEGAL.privacyEmail}. Other enquiries: ${LEGAL.supportEmail}.`,
        `You may lodge a complaint with ${LEGAL.authority} or with the supervisory authority of your habitual residence. We would ask that you raise the matter with us first.`,
      ],
    },
  ],
};
