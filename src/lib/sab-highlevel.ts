const HIGHLEVEL_API_BASE = "https://services.leadconnectorhq.com";
const HIGHLEVEL_VERSION = "v3";

export type SabSourceType = "agency" | "contact";

export interface SabScopeEntry {
  sourceType: SabSourceType;
  sourceRecordId: string;
  displayName: string;
  recordType: string;
  parentAgency: string;
  scopeStatus: "TriBe direct" | "TriBe downline";
}

export interface SabRequirementConfig {
  sourceType: SabSourceType;
  fieldKey: string;
  requirementKey: string;
  requirement: string;
  nextRequiredAction: string;
  actionOwner: string;
  uploadUrl?: string;
  valueMode?: "presence" | "status";
}

interface HighLevelContact {
  id: string;
  dateUpdated?: string;
  customFields?: Array<{ id?: string; key?: string; value?: unknown }>;
}

interface HighLevelObjectRecord {
  id: string;
  updatedAt?: string;
  dateUpdated?: string;
  properties?: Record<string, unknown>;
}

export interface SabMirrorInput {
  sourceSystem: "SAB";
  sourceRecordId: string;
  requirementKey: string;
  affectedRecord: string;
  recordType: string;
  parentAgency: string;
  scopeStatus: string;
  requirement: string;
  nextRequiredAction: string;
  requirementStatus: string;
  actionOwner: string;
  targetFollowUpDate: string;
  uploadUrl: string;
  sourceRecordUrl: string;
  sourceUpdatedAt: string;
}

interface SabRuntimeConfig {
  token: string;
  locationId: string;
  agencySchemaKey: string;
  scope: SabScopeEntry[];
  requirements: SabRequirementConfig[];
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function parseJsonArray<T>(name: string): T[] {
  const raw = required(name);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${name} must be valid JSON.`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`${name} must be a JSON array.`);
  }
  return parsed as T[];
}

function runtimeConfig(): SabRuntimeConfig {
  return {
    token: required("SAB_HIGHLEVEL_TOKEN"),
    locationId: required("SAB_HIGHLEVEL_LOCATION_ID"),
    agencySchemaKey: required("SAB_HIGHLEVEL_AGENCY_SCHEMA_KEY"),
    scope: parseJsonArray<SabScopeEntry>("SAB_SYNC_SCOPE_JSON"),
    requirements: parseJsonArray<SabRequirementConfig>(
      "SAB_REQUIREMENT_FIELDS_JSON",
    ),
  };
}

function assertConfiguration(config: SabRuntimeConfig): void {
  const seen = new Set<string>();
  for (const entry of config.scope) {
    if (
      !entry.sourceRecordId ||
      !entry.displayName ||
      !entry.recordType ||
      !entry.parentAgency ||
      !["agency", "contact"].includes(entry.sourceType) ||
      !["TriBe direct", "TriBe downline"].includes(entry.scopeStatus)
    ) {
      throw new Error("SAB_SYNC_SCOPE_JSON contains an invalid entry.");
    }
    const key = `${entry.sourceType}:${entry.sourceRecordId}`;
    if (seen.has(key)) throw new Error(`Duplicate SAB scope entry: ${key}`);
    seen.add(key);
  }
  for (const requirement of config.requirements) {
    if (
      !requirement.fieldKey ||
      !requirement.requirementKey ||
      !requirement.requirement ||
      !requirement.nextRequiredAction ||
      !requirement.actionOwner ||
      !["agency", "contact"].includes(requirement.sourceType)
    ) {
      throw new Error("SAB_REQUIREMENT_FIELDS_JSON contains an invalid entry.");
    }
  }
}

async function highLevelRequest<T>(
  config: SabRuntimeConfig,
  path: string,
): Promise<T> {
  const response = await fetch(`${HIGHLEVEL_API_BASE}${path}`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${config.token}`,
      Version: HIGHLEVEL_VERSION,
    },
    cache: "no-store",
  });
  if (!response.ok) {
    const requestId =
      response.headers.get("x-request-id") ??
      response.headers.get("x-correlation-id") ??
      "unavailable";
    console.error(
      "SAB HighLevel read failed",
      response.status,
      path.split("?")[0],
      requestId,
    );
    throw new Error(`SAB HighLevel read failed (${response.status}).`);
  }
  return response.json() as Promise<T>;
}

function hasMeaningfulValue(value: unknown): boolean {
  if (value == null || value === false) return false;
  if (Array.isArray(value)) return value.some(hasMeaningfulValue);
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some(
      hasMeaningfulValue,
    );
  }
  const normalized = String(value).trim().toLowerCase();
  return Boolean(normalized) && !["no", "false", "none", "null", "n/a"].includes(normalized);
}

function statusFromValue(
  value: unknown,
  mode: SabRequirementConfig["valueMode"],
): string {
  if (mode !== "status") return hasMeaningfulValue(value) ? "Complete" : "Missing";
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized || ["missing", "not started", "required"].includes(normalized)) {
    return "Missing";
  }
  if (["rejected", "expired", "blocked"].includes(normalized)) {
    return normalized[0].toUpperCase() + normalized.slice(1);
  }
  if (["pending", "submitted", "in review", "processing"].includes(normalized)) {
    return "Pending";
  }
  if (
    ["accepted", "approved", "complete", "completed", "verified"].includes(
      normalized,
    )
  ) {
    return "Complete";
  }
  return "Human Review";
}

function sourceRecordUrl(
  config: SabRuntimeConfig,
  entry: SabScopeEntry,
): string {
  const base = `https://app.gohighlevel.com/v2/location/${encodeURIComponent(config.locationId)}`;
  if (entry.sourceType === "contact") {
    return `${base}/contacts/detail/${encodeURIComponent(entry.sourceRecordId)}`;
  }
  return `${base}/objects/${encodeURIComponent(config.agencySchemaKey.replace(/^custom_objects\./, ""))}/details/${encodeURIComponent(entry.sourceRecordId)}`;
}

async function readScopedRecord(
  config: SabRuntimeConfig,
  entry: SabScopeEntry,
): Promise<{
  updatedAt: string;
  valueFor: (fieldKey: string) => unknown;
}> {
  if (entry.sourceType === "contact") {
    const payload = await highLevelRequest<{ contact?: HighLevelContact }>(
      config,
      `/contacts/${encodeURIComponent(entry.sourceRecordId)}`,
    );
    const contact = payload.contact;
    if (!contact || contact.id !== entry.sourceRecordId) {
      throw new Error(`Allowlisted SAB contact was not returned: ${entry.sourceRecordId}`);
    }
    const fields = contact.customFields ?? [];
    return {
      updatedAt: contact.dateUpdated ?? "",
      valueFor: (fieldKey) =>
        fields.find((field) => field.id === fieldKey || field.key === fieldKey)
          ?.value,
    };
  }

  const payload = await highLevelRequest<{ record?: HighLevelObjectRecord }>(
    config,
    `/objects/${encodeURIComponent(config.agencySchemaKey)}/records/${encodeURIComponent(entry.sourceRecordId)}?locationId=${encodeURIComponent(config.locationId)}`,
  );
  const record = payload.record;
  if (!record || record.id !== entry.sourceRecordId) {
    throw new Error(`Allowlisted SAB agency was not returned: ${entry.sourceRecordId}`);
  }
  return {
    updatedAt: record.updatedAt ?? record.dateUpdated ?? "",
    valueFor: (fieldKey) => record.properties?.[fieldKey],
  };
}

export function buildSabMirrorInputs({
  config,
  records,
}: {
  config: Pick<SabRuntimeConfig, "locationId" | "agencySchemaKey" | "scope" | "requirements">;
  records: Map<
    string,
    { updatedAt: string; valueFor: (fieldKey: string) => unknown }
  >;
}): SabMirrorInput[] {
  const rows: SabMirrorInput[] = [];
  for (const entry of config.scope) {
    const record = records.get(`${entry.sourceType}:${entry.sourceRecordId}`);
    if (!record) continue;
    for (const requirement of config.requirements) {
      if (requirement.sourceType !== entry.sourceType) continue;
      const value = record.valueFor(requirement.fieldKey);
      rows.push({
        sourceSystem: "SAB",
        sourceRecordId: entry.sourceRecordId,
        requirementKey: requirement.requirementKey,
        affectedRecord: entry.displayName,
        recordType: entry.recordType,
        parentAgency: entry.parentAgency,
        scopeStatus: entry.scopeStatus,
        requirement: requirement.requirement,
        nextRequiredAction: requirement.nextRequiredAction,
        requirementStatus: statusFromValue(value, requirement.valueMode),
        actionOwner: requirement.actionOwner,
        targetFollowUpDate: "",
        uploadUrl: requirement.uploadUrl ?? "",
        sourceRecordUrl: sourceRecordUrl(config as SabRuntimeConfig, entry),
        sourceUpdatedAt: record.updatedAt,
      });
    }
  }
  return rows;
}

export function isSabSyncEnabled(): boolean {
  return process.env.SAB_SYNC_ENABLED?.trim().toLowerCase() === "true";
}

export async function readSabMirrorInputs(): Promise<SabMirrorInput[]> {
  const config = runtimeConfig();
  assertConfiguration(config);
  const records = new Map<
    string,
    { updatedAt: string; valueFor: (fieldKey: string) => unknown }
  >();
  for (const entry of config.scope) {
    records.set(
      `${entry.sourceType}:${entry.sourceRecordId}`,
      await readScopedRecord(config, entry),
    );
  }
  return buildSabMirrorInputs({ config, records });
}
