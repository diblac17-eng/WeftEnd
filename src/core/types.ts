/* src/core/types.ts */
/**
 * WeftEnd (WebLayers v2.6) — Core Types (schemas only)
 *
 * Source of truth: docs/weblayers-v2-spec.md + docs/PROJECT_STATE.md
 * Phase rule: schemas only. No executable logic.
 *
 * Import law: core must not import from any other layer.
 */

// -----------------------------
// Result model
// -----------------------------

export type Ok<T> = { ok: true; value: T };
export type Err<E> = { ok: false; error: E };
export type Result<T, E> = Ok<T> | Err<E>;

// -----------------------------
// Canonical identifiers
// -----------------------------

/**
 * Canonical NodeId grammar (v2.6)
 *
 * Strict forms:
 *  - page:/path
 *  - block:<name> or block:@publisher/name
 *  - svc:<name> or svc:@publisher/name
 *  - data:<name> or data:@publisher/name
 *  - priv:<name>
 *  - sess:<name>
 *  - asset:<name>
 */
export type NodeId = string;

// -----------------------------
// Execution primitives
// -----------------------------

export type BlockClass =
  | "ui.static"
  | "ui.compute"
  | "svc.compute"
  | "data.query"
  | "private.secret"
  | "session.auth";

export type ExecutionTier = "cache.global" | "edge.exec" | "origin.exec";
export type ExecutionScope = "request" | "app";

// -----------------------------
// Capability model
// -----------------------------

export type JsonRecord = Record<string, unknown>;

export interface CapabilityRequest {
  capId: string;
  params?: JsonRecord;
}

export interface CapabilityGrant {
  capId: string;
  params?: JsonRecord;
  grantedBy: string;
  notes?: string;
}

export type CapabilityErrorCode =
  | "CAP_DENIED"
  | "CAP_INVALID_PARAMS"
  | "CAP_HOST_ERROR";

export interface CapabilityError {
  code: CapabilityErrorCode;
  capId: string;
  message: string;
}

// -----------------------------
// Identity capability schemas (reserved family)
// -----------------------------

export type IdClaimType =
  | "publisherId"
  | "email"
  | "displayName"
  | "walletAddress";

export interface IdPresentParams {
  purpose: string;
  audience?: string;
  nonce?: string;
  maxAgeSec?: number;
  claimTypes?: IdClaimType[];
}

export interface IdPresentResponse {
  proof: string;
  expiresAt?: string;
  disclosedFields: string[];
}

export interface IdSignParams {
  purpose: string;
  audience?: string;
  nonce?: string;
  challenge: string;
  keyHint?: string;
}

export interface IdSignResponse {
  signature: Signature;
  publicKey?: string;
}

export interface IdConsentParams {
  purpose: string;
  audience?: string;
  scopes?: string[];
  expiresInSec?: number;
}

export interface IdConsentResponse {
  approved: boolean;
  expiresAt?: string;
}

// -----------------------------
// Block ABI
// -----------------------------

export type BlockOutput =
  | { kind: "render.html"; html: string }
  | { kind: "data.json"; json: unknown }
  | {
      kind: "response";
      status: number;
      headers: Record<string, string>;
      body: string;
    }
  | { kind: "denied"; code: string; message: string };

export interface InvocationContext {
  requestId: string;
  pageId?: string;
  /** Present only when session:read is granted by policy. */
  session?: unknown;
}

export type BlockAbi = "ui" | "svc" | "data";

export interface BlockRuntimeSpec {
  abi: BlockAbi;
  scope?: ExecutionScope;
  engine: "js";
  entry: string;
}

// -----------------------------
// Crypto & economy types
// -----------------------------

export interface Signature {
  algo: string;
  keyId: string;
  sig: string;
}

export interface PublisherIdentity {
  publisherId: string;
  keyId: string;
  algo: string;
  publicKey: string;
}

// -----------------------------
// Entitlements (offline license)
// -----------------------------

export interface WeftendEntitlementIssuerV1 {
  keyId: string;
  algo: "sig.ed25519.v0";
}

export interface WeftendEntitlementPayloadV1 {
  schema: "weftend.entitlement/1";
  schemaVersion: 0;
  licenseId: string;
  customerId: string;
  tier: "community" | "enterprise";
  features: string[];
  issuedAt: string; // YYYY-MM-DD
  expiresAt?: string; // YYYY-MM-DD (optional)
  issuer: WeftendEntitlementIssuerV1;
}

export interface WeftendEntitlementV1 extends WeftendEntitlementPayloadV1 {
  signature: {
    sigKind: "sig.ed25519.v0";
    sigB64: string;
  };
}

export type ArtifactRef =
  | {
      kind: "inline";
      mime: string;
      text?: string;
      entry?: string;
    }
  | {
      kind: "ref";
      mime: string;
      ref: string;
      entry?: string;
    };

export interface PackageRef {
  registry?: string;
  /** MUST equal the target nodeId string. */
  locator: string;
  version?: string;
  contentHash: string;
  signature?: Signature;
}

export interface BlockPackage {
  schema: "retni.blockpkg/1";
  nodeId: NodeId;
  contentHash: string;
  publisher?: PublisherIdentity;
  signature?: Signature;
  declaredClass: BlockClass;
  capabilityRequests: CapabilityRequest[];
  runtime: BlockRuntimeSpec;
  artifact: ArtifactRef;
  meta?: {
    name?: string;
    description?: string;
    tags?: string[];
    license?: string;
  };
  publishedAt?: string;
}

export type ChainStampKind = "build" | "compile" | "review" | "audit" | "sign";

export interface ChainStampBody {
  sequenceNumber: number; // 0,1,2...
  kind: ChainStampKind;

  /** Audit garnish only (do NOT trust for ordering). */
  at?: string; // ISO
  by: string; // actor ID

  previousHash?: string | null;

  inputHash?: string;
  outputHash?: string;

  materials?: string[];
  products?: string[];

  witness?: string;
  notes?: string;
}

export interface ChainStamp {
  body: ChainStampBody;
  /** Hash of canonical(body). */
  stampHash: string;
  /** One or more signatures over stampHash (agility/hybrid). */
  signatures: Signature[];
}

export interface PagePackage {
  schema: "retni.pagepkg/1";
  /** must be page:/… */
  pageId: NodeId;
  contentHash: string;
  publisher?: PublisherIdentity;
  signature?: Signature;

  manifest: GraphManifest;

  /**
   * Optional tamper-evident history for the published page root.
   * Ordering comes from sequenceNumber + previousHash (NOT `at`).
   */
  releaseChain?: ChainStamp[];

  requires?: { blockPins: { nodeId: NodeId; contentHash: string }[] };
  embedded?: {
    packages?: BlockPackage[];
    artifacts?: Record<string, ArtifactRef>;
  };
  meta?: {
    name?: string;
    description?: string;
    tags?: string[];
    license?: string;
  };
  publishedAt?: string;
}

// -----------------------------
// Trust policy schema
// -----------------------------

export type TrustStatus = "trusted" | "untrusted" | "unknown";

export interface TrustPolicy {
  id: string;
  rules: TrustRule[];
  grantRules: GrantRule[];
}

/** First match wins. */
export interface TrustRule {
  id: string;
  match: {
    nodeIdPrefix?: string;
    publisherId?: string;
    packageHash?: string;
    pageHash?: string;
  };
  action: "trust" | "deny" | "unknown";
  requireSignature?: boolean;
  requireHashMatch?: boolean;
}

/** First match wins per node+capId. */
export interface GrantRule {
  id: string;
  when: { status: TrustStatus; nodeIdPrefix?: string; publisherId?: string };
  capId: string;
  params?: JsonRecord;
  effect: "grant" | "deny";
}

// -----------------------------
// Graph model
// -----------------------------

export interface Dependency {
  id: NodeId;
  role: string;
  required: boolean;
}

export interface Stamp {
  /**
   * Informational stamps are NOT a security chain.
   * - Do not use `at` for ordering or trust decisions.
   * - Use ChainStamp for tamper-evident construction history.
   */
  id: string;
  kind: string;
  at: string; // ISO (audit garnish)
  by: string;
  message?: string;
  signature?: Signature;
}

export interface Node {
  id: NodeId;
  class: BlockClass;
  title?: string;
  dependencies: Dependency[];

  /** Informational stamps only (non-security). */
  stamps: Stamp[];

  /**
   * Optional tamper-evident construction history.
   * Validated by previousHash + sequenceNumber + stampHash checks (engine/runtime).
   */
  constructionChain?: ChainStamp[];

  capabilityRequests: CapabilityRequest[];
  runtime?: BlockRuntimeSpec;
  artifact?: ArtifactRef | PackageRef;
}

export interface GraphManifest {
  id: string;
  version: "2.6";
  rootPageId: NodeId;
  nodes: Node[];
  createdAt: string;
  createdBy: string;
}

// -----------------------------
// Multi-page project graph
// -----------------------------

export interface ProjectGraph {
  pages: { pageId: NodeId; manifestId: string }[];
  edges: { fromPageId: NodeId; toPageId: NodeId; reason: string }[];
}

export type GraphErrorCode =
  | "CYCLE_DETECTED"
  | "DANGLING_DEPENDENCY"
  | "INVALID_GRAPH"
  | "INVALID_NODE"
  | "INVALID_DEPENDENCY"
  | "DUPLICATE_NODE"
  | "MISSING_ROOT"
  | "INVALID_NODE_ID";

export interface GraphError {
  code: GraphErrorCode;
  message: string;
  nodeId?: NodeId;
  path?: string;
}

// -----------------------------
// Build / import schemas (bridge layer)
// -----------------------------

export type ImportErrorCode =
  | "IMPORT_PARSE_ERROR"
  | "IMPORT_INVALID_SCHEMA"
  | "IMPORT_INVALID_NODE_ID"
  | "IMPORT_UNSUPPORTED"
  | "IMPORT_EMPTY";

export interface ImportError {
  code: ImportErrorCode;
  message: string;
  path?: string;
}

export type BuildErrorCode =
  | "BUILD_INVALID_DESIGN"
  | "BUILD_INVALID_NODE_ID"
  | "BUILD_GRAPH_ERROR"
  | "BUILD_DUPLICATE_NODE"
  | "BUILD_MISSING_ROOT";

export interface BuildError {
  code: BuildErrorCode;
  message: string;
  nodeId?: NodeId;
  path?: string;
}

export type TrustErrorCode =
  | "TRUST_POLICY_INVALID"
  | "TRUST_DENIED"
  | "TRUST_SIGNATURE_REQUIRED"
  | "TRUST_SIGNATURE_INVALID"
  | "TRUST_HASH_MISMATCH"
  | "TRUST_PKG_MISSING"
  | "TRUST_PKG_AMBIGUOUS";

export type EvidenceKind =
  | "signature.v1"
  | "hash.v1"
  | "content-address.v1"
  | "key.status.v1"
  | (string & {});

export interface TrustError {
  code: TrustErrorCode;
  message: string;
  nodeId?: NodeId;
  path?: string;
}

/**
 * PageDesignTree is an intermediate representation produced by devkit importers.
 * Engine code must validate before use.
 */
export interface PageDesignTree {
  schema: "retni.design/1";
  pageId: NodeId;
  title?: string;
  /** Root-level parts in document order. */
  parts: DesignPart[];
}

export type DesignPart = DesignBlock | DesignHtml;

export interface DesignBlock {
  kind: "block";
  nodeId: NodeId;
  instanceId?: string;
  declaredClass?: BlockClass;
  title?: string;
  props?: JsonRecord;
  deps?: { nodeId: NodeId; role: string; required?: boolean }[];
  capabilityRequests?: CapabilityRequest[];
  runtime?: BlockRuntimeSpec;
  artifact?: ArtifactRef | PackageRef;
}

export interface DesignHtml {
  kind: "html";
  html: string;
  title?: string;
}

// -----------------------------
// Trust + plan + bundle (runtime-enforceable contract)
// -----------------------------

export interface CryptoEvidence {
  hashVerified?: boolean;
  signatureVerified?: boolean;
  verifiedByKeyId?: string;
  notes?: string;
}

export type KeyStatusState = "active" | "expired" | "revoked" | "emergency-disable";

export interface KeyStatus {
  state: KeyStatusState;
  keySetId?: string;
  issuer?: string;
  validFrom?: string;
  validTo?: string;
  reason?: string;
  notes?: string;
}

export interface TrustDigest {
  producerHash: string | null;
  inputsHash: string | null;
  outputHash: string | null;
  grantedCaps: CapabilityGrant[];
}

export interface TrustNodeResult {
  nodeId: NodeId;
  status: TrustStatus;
  reasons: string[];

  /** Legacy mirror; must equal digest.grantedCaps */
  grants: CapabilityGrant[];

  digest: TrustDigest;

  publisherId?: string;

  /** Legacy mirror; if present and digest.producerHash != null they must match */
  packageHash?: string;

  crypto?: CryptoEvidence;

  normalizedClaims?: NormalizedClaim[];
}

export interface TrustResult {
  manifestId: string;
  policyId: string;
  nodes: TrustNodeResult[];
  /** Optional evidence bundles grouped per node; unknown kinds fail closed at policy gates. */
  verifierOutputs?: VerifierOutput[];
}

export interface EvidenceEnvelope {
  /** The kind of evidence; unknown kinds fail closed at policy gates. */
  kind: EvidenceKind;
  /** Opaque payload; not interpreted by kernel, but canonicalized for hashing. */
  payload: unknown;
  /** Optional metadata for provenance/audit. */
  meta?: {
    issuedAt?: string;
    expiresAt?: string;
    issuedBy?: string;
    scope?: string;
  };
}

export interface NormalizedClaim {
  /** Stable identifier for deterministic sorting. */
  claimId: string;
  /** Evidence envelope this claim was derived from. */
  evidenceKind: EvidenceKind;
  /** Canonicalizable normalized claims (kernel-visible structure). */
  normalized: {
    type: string;
    version: string;
    subjectId?: string;
    keySetId?: string;
    status?: KeyStatus;
    validFrom?: string;
    validTo?: string;
    issuer?: string;
    /** Additional structured fields for future use; must be deterministic. */
    fields?: JsonRecord;
  };
  /** Raw verifier payload (opaque to kernel). */
  raw?: unknown;
}

export interface VerifierOutput {
  nodeId: NodeId;
  evidence: EvidenceEnvelope[];
  normalizedClaims?: NormalizedClaim[];
  warnings?: string[];
  errors?: string[];
}

// -----------------------------
// Consent + SecretBox (proof-only)
// -----------------------------

export interface ConsentClaimV0 {
  consentId: string;
  action: "id.sign";
  subject: { blockHash: string; planDigest: string };
  scope?: string[];
  issuerId: string;
  seq: number;
}

export type SecretBoxKind =
  | "auth.token"
  | "crypto.key"
  | "payment.token"
  | "opaque.secret";

export interface SecretBoxBindings {
  planHash: string;
  issuerId: string;
  mintedSeq?: number;
  mintedAt?: string;
}

export interface SecretBox {
  schema: "retni.secretbox/1";
  kind: SecretBoxKind;
  secretB64: string;
  bindings: SecretBoxBindings;
  secretHash: string;
  boxDigest: string;
}

export interface NetConstraint {
  allowOrigins: string[];
  allowMethods: ("GET" | "POST" | "PUT" | "PATCH" | "DELETE")[];
}

export interface KvConstraint {
  allowNamespaces: string[];
}

export interface DbConstraint {
  allowConnections: string[];
}

export interface SecretsConstraint {
  allowNames: string[];
}

export interface SessionConstraint {
  allowRead: boolean;
  allowWrite: boolean;
}

export interface PlanConstraints {
  net?: NetConstraint;
  kv?: KvConstraint;
  db?: DbConstraint;
  secrets?: SecretsConstraint;
  session?: SessionConstraint;
}

export interface PlanNode {
  nodeId: NodeId;
  tier: ExecutionTier;
  allowExecute: boolean;
  denyReason?: string;
  grantedCaps: CapabilityGrant[];
  constraints?: PlanConstraints;
}

export interface ExecutionPlan {
  manifestId: string;
  policyId: string;
  nodes: PlanNode[];
  planHash: string;
}

export interface CompilerStamp {
  compilerId: string;
  compilerVersion: string;
  builtAt: string; // ISO
  manifestHash: string;
  trustHash: string;
  planHash: string; // MUST equal plan.planHash
}

export interface RuntimeBundle {
  manifest: GraphManifest;
  trust: TrustResult;
  plan: ExecutionPlan;

  compiler: CompilerStamp;

  packages?: BlockPackage[];
  artifacts?: Record<string, ArtifactRef>;
}

export type PortalRenderState = "VERIFIED" | "UNVERIFIED";

export interface PortalNodeEntry {
  nodeId: NodeId;
  renderState: PortalRenderState;
  /** Required when renderState = UNVERIFIED. */
  reason?: string;
  /** Stable-sorted by evidenceKind then canonical payload. */
  evidence: EvidenceEnvelope[];
  /** Stable-sorted by claimId then evidenceKind then canonical normalized payload. */
  claims: NormalizedClaim[];
  manifestNode?: Node;
  trust?: TrustNodeResult;
  plan?: PlanNode;
  warnings?: string[];
  errors?: string[];
}

export interface PortalModel {
  manifestId: string;
  planHash: string;
  pageId: NodeId;
  nodes: PortalNodeEntry[];
  warnings?: string[];
  errors?: string[];
  /**
   * Deterministic rendering invariant:
   * - nodes stable-sorted by nodeId.
   * - evidence within each node stable-sorted by evidenceKind then canonical payload.
   * - claims within each node stable-sorted by claimId then evidenceKind then canonical normalized payload.
   * - portal renders only from manifest/trust/plan commitments + verifier outputs; no ambient state.
   * - verification failure must produce renderState = UNVERIFIED with explicit reason.
   */
}

// -----------------------------
// Library facade schemas
// -----------------------------

export interface BuildFromHtmlInput {
  html: string;
  pageId: NodeId;
  policy?: TrustPolicy;
}

export type BuildFromHtmlResult =
  | { ok: true; bundle: RuntimeBundle; design: PageDesignTree }
  | {
      ok: false;
      stage: "import" | "build" | "trust";
      errors: (ImportError | BuildError | TrustError)[];
    };

// -----------------------------
// Cyclic runtime reactor boundary (gaming/streaming)
// -----------------------------

export type ReactorErrorCode = "REACTOR_INVALID_SNAPSHOT" | "REACTOR_DENIED" | "REACTOR_HOST_ERROR";

export interface ReactorError {
  code: ReactorErrorCode;
  message: string;
}

export interface ReactorSnapshot {
  /**
   * Approved snapshot from the outer DAG.
   * Runtime must treat this as the sole authority input for the reactor.
   */
  snapshotId: string;
  bundle: RuntimeBundle;
}

export type ReactorInput =
  | { kind: "tick"; dtMs: number; at?: string }
  | { kind: "event"; name: string; at?: string; data?: unknown };

export type ReactorEvent =
  | { kind: "telemetry"; at: string; channel: string; data: unknown }
  | { kind: "derived"; at: string; nodeId: NodeId; output: BlockOutput };

export interface ReactorStepResult {
  events: ReactorEvent[];
}

// -----------------------------
// Proof-only v0 types (restored for kernel exports)
// -----------------------------

export type ExecutionMode = "strict" | "compatible" | "legacy";

export type EvidenceVerifyStatus = "VERIFIED" | "UNVERIFIED";

export interface EvidenceVerifyResult {
  evidenceId: string;
  kind: EvidenceKind;
  status: EvidenceVerifyStatus;
  reasonCodes: string[];
  verifierId: string;
  verifierVersion?: string;
  normalizedClaims?: NormalizedClaim[];
}

export type EvidenceExpr =
  | { kind: "evidence"; evidenceKind: EvidenceKind }
  | { kind: "allOf"; items: EvidenceExpr[] }
  | { kind: "anyOf"; items: EvidenceExpr[] };

export interface CapEvidenceRequirement {
  capId: string;
  requires: EvidenceExpr;
}

export type PulseKindV0 =
  | "PUBLISH"
  | "LOAD"
  | "CAP_REQUEST"
  | "CAP_DENY"
  | "CAP_ALLOW"
  | "EXIT";

export interface PulseSubjectV0 {
  kind: "release" | "block";
  id: string;
}

export interface PulseDigestSetV0 {
  releaseId?: string;
  pathDigest?: string;
  planHash?: string;
  evidenceHead?: string;
}

export interface PulseCountsV0 {
  capsRequested?: number;
  capsDenied?: number;
  tartarusNew?: number;
}

export interface PulseBodyV0 {
  schema: "weftend.pulse/0";
  v: 0;
  pulseSeq: number;
  kind: PulseKindV0;
  subject: PulseSubjectV0;
  capId?: string;
  reasonCodes?: string[];
  digests?: PulseDigestSetV0;
  counts?: PulseCountsV0;
}

export interface PulseV0 extends PulseBodyV0 {
  pulseDigest: string;
}

export interface ReceiptSummaryV0 {
  schema: "weftend.receiptSummary/0";
  v: 0;
  total: number;
  denies: number;
  quarantines: number;
  lastReceiptId?: string;
  bindTo: { releaseId: string; pathDigest: string };
  receiptDigest: string;
}

// -----------------------------
// Mint package v1 (product output)
// -----------------------------

export type MintProfileV1 = "web" | "mod" | "generic";
export type MintInputKindV1 = "file" | "dir" | "zip";
export type MintGradeStatusV1 = "OK" | "WARN" | "DENY" | "QUARANTINE";

export interface MintInputV1 {
  kind: MintInputKindV1;
  rootDigest: string;
  fileCount: number;
  totalBytes: number;
}

export interface MintCaptureV1 {
  captureDigest: string;
  paths?: string[];
}

export interface MintFileKindCountsV1 {
  html: number;
  js: number;
  css: number;
  json: number;
  wasm: number;
  media: number;
  binary: number;
  other: number;
}

export interface MintObservationsV1 {
  fileKinds: MintFileKindCountsV1;
  externalRefs: string[];
  scriptsDetected: boolean;
  wasmDetected: boolean;
}

export interface MintProbeResultV1 {
  status: MintGradeStatusV1;
  reasonCodes: string[];
  deniedCaps: Record<string, number>;
  attemptedCaps: Record<string, number>;
}

export interface MintReceiptV1 {
  kind: string;
  digest: string;
  summaryCounts?: Record<string, number>;
  reasonCodes?: string[];
}

export interface MintGradeV1 {
  status: MintGradeStatusV1;
  reasonCodes: string[];
  receipts: MintReceiptV1[];
  scars?: string[];
}

export interface MintDigestsV1 {
  mintDigest: string;
  inputDigest: string;
  policyDigest: string;
}

export interface MintLimitsV1 {
  maxFiles: number;
  maxTotalBytes: number;
  maxFileBytes: number;
  maxExternalRefs: number;
  maxScriptBytes: number;
  maxScriptSteps: number;
}

export interface WeftendMintPackageV1 {
  schema: "weftend.mint/1";
  profile: MintProfileV1;
  input: MintInputV1;
  capture?: MintCaptureV1;
  observations: MintObservationsV1;
  executionProbes: {
    strictAvailable: boolean;
    strictUnavailableReason?: string;
    loadOnly: MintProbeResultV1;
    interactionScript?: MintProbeResultV1;
  };
  grade: MintGradeV1;
  digests: MintDigestsV1;
  limits: MintLimitsV1;
}

// -----------------------------
// Platform intake (policy + decision) v1
// -----------------------------

export type EvidenceProfileV1 = "web" | "mod" | "plugin" | "release";
export type IntakeActionV1 = "APPROVE" | "QUEUE" | "REJECT" | "HOLD";
export type IntakeSeverityV1 = "INFO" | "WARN" | "DENY" | "QUARANTINE";

export interface WeftEndPolicyV1 {
  schema: "weftend.intake.policy/1";
  profile: EvidenceProfileV1;
  reasonSeverity: Record<string, IntakeSeverityV1>;
  severityAction: Record<IntakeSeverityV1, IntakeActionV1>;
  capsPolicy: {
    net?: { allowedDomains: string[]; allowIfUnsigned?: boolean };
    fs?: { allowedPaths: string[] };
    storage?: { allow?: boolean };
    childProcess?: { allow?: boolean };
  };
  disclosure: {
    requireOnWARN: boolean;
    requireOnDENY: boolean;
    maxLines: number;
  };
  bounds: {
    maxReasonCodes: number;
    maxCapsItems: number;
    maxDisclosureChars: number;
    maxAppealBytes: number;
  };
}

export interface IntakeDecisionV1 {
  schema: "weftend.intake.decision/1";
  profile: EvidenceProfileV1;
  policyId: string;
  artifactId: string;
  mintId?: string;
  grade: "OK" | "WARN" | "DENY" | "QUARANTINE";
  action: IntakeActionV1;
  topReasonCodes: string[];
  capSummary: {
    denied: number;
    attempted: number;
    byKind: Record<string, { attempted: number; denied: number }>;
    notable?: string[];
  };
  disclosureDigest: string;
  appealDigest: string;
  decisionDigest: string;
}

export type IntakeAppealBundleV1 =
  | {
      schema: "weftend.intake.appeal/1";
      status: "OVERSIZE";
      bytes: number;
    }
  | {
      schema: "weftend.intake.appeal/1";
      policyId: string;
      artifactId: string;
      mintId?: string;
      topReasonCodes: string[];
      receiptDigests: string[];
      probeScriptDigest?: string;
    };

// -----------------------------
// Run receipt v0 (CLI orchestration)
// -----------------------------

export type RunExecutionStatusV0 = "ALLOW" | "DENY" | "QUARANTINE" | "SKIP";
export type RunModeEffectiveV0 = ExecutionMode;

export type StrictVerifyVerdictV0 = "ALLOW" | "DENY" | "QUARANTINE";
export type StrictExecuteOutcomeV0 = "ALLOW" | "DENY" | "SKIP";

export type WeftendBuildSourceV0 = "HOST_BINARY_PATH" | "NODE_MAIN_JS" | "UNKNOWN";

export interface WeftendBuildV0 {
  algo: "sha256";
  digest: string;
  source: WeftendBuildSourceV0;
  reasonCodes?: string[];
}

export interface StrictVerifyResultV0 {
  verdict: StrictVerifyVerdictV0;
  reasonCodes: string[];
  releaseStatus: "OK" | "UNVERIFIED" | "MAYBE";
  releaseReasonCodes: string[];
  releaseId?: string;
}

export interface StrictExecuteResultV0 {
  attempted: boolean;
  result: StrictExecuteOutcomeV0;
  reasonCodes: string[];
}

export interface RunReceiptV0 {
  schema: "weftend.runReceipt/0";
  v: 0;
  schemaVersion: 0;
  weftendBuild: WeftendBuildV0;
  modeRequested: ExecutionMode;
  modeEffective: RunModeEffectiveV0;
  profile: MintProfileV1;
  inputDigest: string;
  contentSummary: ContentSummaryV0;
  policyId: string;
  mintDigest: string;
  intakeDecisionDigest: string;
  intakeAction: IntakeActionV1;
  intakeGrade: IntakeDecisionV1["grade"];
  envGates: {
    strictExecAllowed: boolean;
    demoCryptoAllowed: boolean;
  };
  strictVerify: StrictVerifyResultV0;
  strictExecute: StrictExecuteResultV0;
  artifactsWritten: Array<{ name: string; digest: string }>;
  execution: {
    status: RunExecutionStatusV0;
    reasonCodes: string[];
  };
  receiptDigest: string;
}

// -----------------------------
// Safe-run receipt v0 (right-click flow)
// -----------------------------

export type SafeRunInputKindV0 = "raw" | "release";
export type SafeRunExecutionResultV0 = "ALLOW" | "DENY" | "SKIP" | "WITHHELD";
export type ArtifactKindV0 =
  | "RELEASE_DIR"
  | "WEB_DIR"
  | "ZIP"
  | "NATIVE_EXE"
  | "NATIVE_MSI"
  | "CONTAINER_IMAGE"
  | "SHORTCUT_LNK"
  | "SCRIPT_JS"
  | "SCRIPT_PS1"
  | "TEXT"
  | "UNKNOWN";
export type SafeRunAnalysisVerdictV0 = "ALLOW" | "WITHHELD" | "DENY";
export type SafeRunExecutionVerdictV0 = "NOT_ATTEMPTED" | "SKIP" | "ALLOW" | "DENY";

export interface SafeRunReceiptV0 {
  schema: "weftend.safeRunReceipt/0";
  v: 0;
  schemaVersion: 0;
  weftendBuild: WeftendBuildV0;
  inputKind: SafeRunInputKindV0;
  artifactKind: ArtifactKindV0;
  entryHint?: string | null;
  contentSummary: ContentSummaryV0;
  analysisVerdict: SafeRunAnalysisVerdictV0;
  executionVerdict: SafeRunExecutionVerdictV0;
  topReasonCode: string;
  inputDigest?: string;
  releaseId?: string;
  releaseDirDigest?: string;
  policyId: string;
  intakeDecisionDigest?: string;
  hostReceiptDigest?: string;
  hostSelfId?: string;
  hostSelfStatus?: "OK" | "UNVERIFIED" | "MISSING";
  hostSelfReasonCodes?: string[];
  adapter?: {
    adapterId: string;
    sourceFormat: string;
    mode: "built_in" | "plugin";
    reasonCodes: string[];
  };
  execution: { result: SafeRunExecutionResultV0; reasonCodes: string[] };
  subReceipts: Array<{ name: string; digest: string }>;
  receiptDigest: string;
}

// -----------------------------
// Content summary v0 (analysis-only signals)
// -----------------------------

export type ContentTargetKindV0 = "nativeBinary" | "shortcut" | "directory" | "zip" | "file" | "missing";
export type ContentArtifactKindV0 = "executable" | "webBundle" | "dataOnly" | "unknown";

export interface ContentSummaryV0 {
  targetKind: ContentTargetKindV0;
  artifactKind: ContentArtifactKindV0;
  fileCountsByKind: MintFileKindCountsV1;
  totalFiles: number;
  totalBytesBounded: number;
  sizeSummary: {
    totalBytesBounded: number;
    truncated: boolean;
  };
  topExtensions: Array<{ ext: string; count: number }>;
  hasNativeBinaries: boolean;
  hasScripts: boolean;
  hasHtml: boolean;
  externalRefs: {
    count: number;
    topDomains: string[];
  };
  entryHints: string[];
  boundednessMarkers: string[];
  archiveDepthMax: number;
  nestedArchiveCount: number;
  manifestCount: number;
  stringsIndicators: {
    urlLikeCount: number;
    ipLikeCount: number;
    powershellLikeCount: number;
    cmdExecLikeCount: number;
  };
  adapterSignals?: {
    class: string;
    counts: Record<string, number>;
    markers: string[];
  };
  signingSummary?: {
    signaturePresent: "yes" | "no" | "unknown";
    signerCountBounded: number;
    timestampPresent: "yes" | "no" | "unknown";
    importTablePresent: "yes" | "no" | "unknown";
    importTableSize?: number;
    peMachine?: string;
    peSections?: number;
  };
  policyMatch: {
    selectedPolicy: string;
    reasonCodes: string[];
  };
  hashFamily: {
    sha256: string;
  };
}

// -----------------------------
// Operator receipt v0 (top-level summary)
// -----------------------------

export type OperatorCommandV0 = "host status" | "host run" | "host update" | "run" | "safe-run" | "compare" | "container scan";

export interface OperatorReceiptEntryV0 {
  kind: string;
  relPath: string;
  digest: string;
}

export interface OperatorReceiptV0 {
  schema: "weftend.operatorReceipt/0";
  v: 0;
  schemaVersion: 0;
  weftendBuild: WeftendBuildV0;
  command: OperatorCommandV0;
  outRootDigest: string;
  receipts: OperatorReceiptEntryV0[];
  warnings: string[];
  contentSummary?: ContentSummaryV0;
  receiptDigest: string;
}

// -----------------------------
// Compare receipt v0 (run-to-run diff)
// -----------------------------

export interface CompareSideRefV0 {
  summaryDigest: string;
  receiptKinds: string[];
}

export interface CompareChangeV0 {
  bucket: string;
  added: string[];
  removed: string[];
  counts?: Record<string, number>;
}

export interface CompareReceiptV0 {
  schema: "weftend.compareReceipt/0";
  v: 0;
  schemaVersion: 0;
  weftendBuild: WeftendBuildV0;
  kind: "CompareReceiptV0";
  left: CompareSideRefV0;
  right: CompareSideRefV0;
  verdict: "SAME" | "CHANGED";
  changeBuckets: string[];
  changes: CompareChangeV0[];
  privacyLint: "PASS" | "FAIL";
  reasonCodes: string[];
  receiptDigest: string;
}

// -----------------------------
// Host run receipt v0 (Node host)
// -----------------------------

export type HostOutRootSourceV0 = "ARG_OUT" | "ENV_OUT_ROOT";

export interface HostStatusReceiptV0 {
  schema: "weftend.host.statusReceipt/0";
  v: 0;
  schemaVersion: 0;
  weftendBuild: WeftendBuildV0;
  hostBinaryDigest: string;
  hostConfigDigest: string;
  enforcementVersion: string;
  outRootEffective: string;
  outRootSource: HostOutRootSourceV0;
  verifyResult: "OK" | "UNVERIFIED";
  reasonCodes: string[];
  timestampMs: number;
  receiptDigest: string;
  signature?: Signature;
}

export type HostVerifyVerdictV0 = "ALLOW" | "DENY";
export type HostExecuteOutcomeV0 = "ALLOW" | "DENY" | "SKIP";

export interface HostRunReceiptV0 {
  version: "host_run_receipt_v0";
  schemaVersion: 0;
  weftendBuild: WeftendBuildV0;
  gateModeRequested?: "enforced";
  gateVerdict?: "ALLOW" | "BLOCK";
  gateReasonCodes?: string[];
  releaseDirDigest: string;
  contentSummary: ContentSummaryV0;
  releaseId?: string;
  hostSelfId?: string;
  hostSelfStatus: "OK" | "UNVERIFIED" | "MISSING";
  hostSelfReasonCodes: string[];
  releaseStatus: "OK" | "UNVERIFIED" | "MAYBE";
  releaseReasonCodes: string[];
  verify: { verdict: HostVerifyVerdictV0; reasonCodes: string[] };
  execute: { attempted: boolean; result: HostExecuteOutcomeV0; reasonCodes: string[]; executionOk?: boolean };
  entryUsed: string;
  caps: { requested: string[]; granted: string[]; denied: string[] };
  artifactDigests: { releaseManifest: string; runtimeBundle: string; evidenceBundle: string; publicKey: string };
  artifactsWritten: Array<{ name: string; digest: string }>;
  receiptDigest: string;
}

// -----------------------------
// Host self manifest v0 (self-update trust root)
// -----------------------------

export interface HostSelfManifestBodyV0 {
  hostVersion: string;
  releaseId: string;
  releaseManifestDigest: string;
  runtimeBundleDigest: string;
  evidenceDigest: string;
  publicKeyDigest: string;
  policyDigest?: string;
}

export interface HostSelfManifestSignatureV0 {
  sigKind: string;
  keyId: string;
  sigB64: string;
}

export interface HostSelfManifestV0 {
  schema: "weftend.host.self/0";
  hostSelfId: string;
  body: HostSelfManifestBodyV0;
  signatures: HostSelfManifestSignatureV0[];
}

export type HostUpdateDecisionV0 = "ALLOW" | "DENY";
export type HostUpdateApplyResultV0 = "APPLIED" | "ROLLED_BACK" | "SKIP";

export interface HostUpdateReceiptV0 {
  schema: "weftend.host.updateReceipt/0";
  v: 0;
  schemaVersion: 0;
  weftendBuild: WeftendBuildV0;
  hostRootDigest: string;
  releaseId?: string;
  hostSelfId?: string;
  decision: HostUpdateDecisionV0;
  reasonCodes: string[];
  verify: { status: "OK" | "UNVERIFIED"; reasonCodes: string[] };
  apply: { attempted: boolean; result: HostUpdateApplyResultV0; reasonCodes: string[] };
  artifactsWritten: Array<{ name: string; digest: string }>;
  receiptDigest: string;
}

export interface PortalEvidenceSummary {
  evidenceKind: EvidenceKind;
  evidenceDigest: string;
  issuerId?: string;
  status: PortalRenderState;
  reasonCodes?: string[];
}

export interface PortalCapDenial {
  capId: string;
  reasonCodes: string[];
}

export type PortalEvidenceStatus = "VERIFIED" | "UNVERIFIED" | "MISSING" | "UNSUPPORTED";

export interface PortalCapEvidenceStatus {
  evidenceKind: EvidenceKind;
  status: PortalEvidenceStatus;
  reasonCodes?: string[];
}

export interface PortalCapEvidenceSummary {
  capId: string;
  evidence: PortalCapEvidenceStatus[];
}

export type PortalStampStatus = "STAMP_VERIFIED" | "STAMP_INVALID" | "UNSTAMPED";
export type PortalStampSigStatus = "OK" | "BAD" | "UNVERIFIED";

export interface PortalRuntimeStampObservation {
  status: PortalStampStatus;
  sigStatus?: PortalStampSigStatus;
  reasonCodes?: string[];
}

export interface PortalBlockRowV0 {
  blockHash: string;
  executionMode: ExecutionMode;
  renderState: PortalRenderState;
  reasonCodes?: string[];
  requestedCaps: string[];
  eligibleCaps: string[];
  deniedCaps: PortalCapDenial[];
  evidence: PortalEvidenceSummary[];
  capEvidence?: PortalCapEvidenceSummary[];
  tartarusLatest?: TartarusRecordV0;
  marketId?: string;
  marketPolicyDigest?: string;
  receiptDecision?: "ALLOW" | "DENY";
  receiptId?: string;
  receiptReasonCodes?: string[];
  stampStatus?: PortalStampStatus;
  stampSigStatus?: PortalStampSigStatus;
  runtimeObservedStamp?: PortalRuntimeStampObservation;
}

export interface PortalSummaryV0 {
  totalBlocks: number;
  verifiedBlocks: number;
  unverifiedBlocks: number;
  modes: {
    strict: number;
    compatible: number;
    legacy: number;
  };
}

export interface PortalProjectionTruncationV0 {
  code: "PORTAL_PROJECTION_TRUNCATED";
  section: string;
  kept: number;
  dropped: number;
}

export interface PortalPulseGroupV0 {
  blockHash: string;
  pulses: PulseV0[];
}

export interface PortalPulseSummaryV0 {
  release?: PulseV0[];
  blocks?: PortalPulseGroupV0[];
}

export interface PortalModelV0 {
  schema: "retni.portalmodel/1";
  planDigest: string;
  summary: PortalSummaryV0;
  blocks: PortalBlockRowV0[];
  marketId?: string;
  marketPolicyDigest?: string;
  receiptSummary?: ReceiptSummaryV0;
  receiptVerified?: boolean;
  releaseStatus?: "OK" | "UNVERIFIED" | "MAYBE";
  releaseReasonCodes?: string[];
  releaseId?: string;
  releasePathDigest?: string;
  historyHeadDigest?: string;
  historyStatus?: "OK" | "UNVERIFIED";
  historyReasonCodes?: string[];
  tartarus?: TartarusSummaryV0;
  pulses?: PortalPulseSummaryV0;
  warnings?: string[];
  projectionTruncations?: PortalProjectionTruncationV0[];
  buildAttestation?: {
    required?: boolean;
    status: "VERIFIED" | "UNVERIFIED" | "MISSING";
    evidenceDigest?: string;
    reasonCodes?: string[];
    summary?: {
      pipelineId: string;
      weftendVersion: string;
      bundleHash: string;
      pathDigest: string;
      manifestHash: string;
    };
  };
}

export type TartarusSeverity = "INFO" | "WARN" | "DENY" | "QUARANTINE";
export type TartarusRemedy =
  | "PROVIDE_EVIDENCE"
  | "DOWNGRADE_MODE"
  | "MOVE_TIER_DOWN"
  | "REBUILD_FROM_TRUSTED"
  | "CONTACT_SHOP"
  | "NONE";

export type TartarusKind =
  | "stamp.missing"
  | "stamp.invalid"
  | "tier.violation"
  | "membrane.selftest.failed"
  | "cap.replay"
  | "secretzone.unavailable"
  | "secret.leak.attempt"
  | "privacy.field.forbidden"
  | "privacy.timestamp.forbidden"
  | "privacy.string.untrusted"
  | "privacy.receipt.oversize"
  | "privacy.receipt.unbounded"
  | "artifact.mismatch"
  | "pkg.locator.mismatch"
  | "evidence.digest.mismatch"
  | "release.manifest.invalid"
  | "release.manifest.mismatch"
  | "release.signature.bad"
  | "history.invalid"
  | "history.signature.bad"
  | "history.link.mismatch"
  | "market.takedown.active"
  | "market.ban.active"
  | "market.allowlist.missing"
  | "market.evidence.missing";

export interface TartarusRecordV0 {
  schema: "weftend.tartarus/0";
  recordId: string;
  planDigest: string;
  blockHash: string;
  kind: TartarusKind;
  severity: TartarusSeverity;
  remedy: TartarusRemedy;
  reasonCodes: string[];
  stampDigest?: string;
  evidenceDigests?: string[];
  seq?: number;
}

export interface TartarusSummaryV0 {
  total: number;
  bySeverity: Record<TartarusSeverity, number>;
  byKind: Record<TartarusKind, number>;
}

export type TierId = "T0" | "T1" | "T2" | "T3";
export type MarketId = string;
export type ShopId = string;
export type MarketPolicyDigest = string;

export type GateIdV0 =
  | "market.admission.v0"
  | "market.install.v0"
  | "runtime.grant.v0"
  | "market.takedown.v0";

export interface GateReceiptBodyV0 {
  schema: "weftend.gateReceipt/0";
  gateId: GateIdV0;
  marketId: MarketId;
  marketPolicyDigest: MarketPolicyDigest;
  planDigest: string;
  releaseId: string;
  blockHash: string;
  decision: "ALLOW" | "DENY";
  reasonCodes: string[];
  checkpointDigest: string;
}

export interface ReleaseManifestBodyV0 {
  planDigest: string;
  policyDigest: string;
  blocks: string[];
  evidenceJournalHead?: string;
  tartarusJournalHead?: string;
  pathDigest: string;
  buildInfo?: { toolId: string; toolVer: string };
}

export interface ReleaseManifestSignatureV0 {
  sigKind: string;
  keyId: string;
  sigB64: string;
}

export interface ReleaseManifestV0 {
  schema: "weftend.release/0";
  releaseId: string;
  manifestBody: ReleaseManifestBodyV0;
  signatures: ReleaseManifestSignatureV0[];
}

export interface ReleaseVerifyResultV0 {
  status: "OK" | "UNVERIFIED" | "MAYBE";
  reasonCodes: string[];
  observedReleaseId?: string;
  observedPlanDigest?: string;
  observedPathDigest?: string;
}

export interface GateReceiptV0 {
  receiptId: string;
  body: GateReceiptBodyV0;
  signatures?: Array<{ sigKind: string; keyId: string; sigB64: string }>;
}

export interface ShopStamp {
  schema: "retni.shopstamp/1";
  tier: TierId;
  shopId: ShopId;
  policyDigest: string;
  blockHash: string;
  acceptDecision: "ACCEPT" | "REJECT";
  reasonCodes: string[];
  stampDigest: string;
  signature?: Signature;
}

export interface PathSummaryV0 {
  schema: "weftend.pathSummary/0";
  v: 0;
  pipelineId: string;
  weftendVersion: string;
  publishInputHash: string;
  trustPolicyHash: string;
  anchors: { a1Hash: string; a2Hash: string; a3Hash: string };
  plan: { planHash: string; trustHash: string };
  bundle: { bundleHash: string };
  packages: Array<{ locator: string; digest: string }>;
  artifacts: Array<{ ref: string; digest: string }>;
}

export interface PlanSnapshotV0 {
  schema: "weftend.plan/0";
  graphDigest: string;
  artifacts: Array<{ nodeId: string; contentHash: string }>;
  policyDigest: string;
  evidenceDigests: string[];
  grants: Array<{ blockHash: string; eligibleCaps: string[] }>;
  mode: ExecutionMode;
  tier: string;
  pathSummary: PathSummaryV0;
}

export interface EvidenceRecord {
  kind: EvidenceKind;
  payload: unknown;
  issuer?: string;
  subject?: { planDigest?: string; releaseId?: string; blockHash?: string };
  evidenceId?: string;
  meta?: {
    issuedAt?: string;
    expiresAt?: string;
    issuedBy?: string;
    scope?: string;
  };
}

export interface EvidenceBundleV0 {
  schema: "weftend.evidence/0";
  records: EvidenceRecord[];
}

export interface StrictPolicyV0 {
  requireBuildAttestation?: boolean;
}
