import { createHash } from "node:crypto";
import { GoogleAuth } from "google-auth-library";
import { normalizePhone, type Contact } from "./contacts";
import type { SabMirrorInput } from "./sab-highlevel";

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const SHEETS_BASE_URL = "https://sheets.googleapis.com/v4/spreadsheets";
const SAB_MIRROR_SHEET = "SAB Read-Only Mirror";
const SAB_MIRROR_HEADERS = [
  "Source System",
  "Source Record ID",
  "Requirement Key",
  "Affected Record",
  "Record Type",
  "Parent Agency",
  "Scope Status",
  "Requirement",
  "Next Required Action",
  "Requirement Status",
  "Action Owner",
  "Target Follow-up Date",
  "Upload Link",
  "Source Record Link",
  "Source Updated At",
  "Last Synced At",
  "Linked Action ID",
  "Sync Result",
  "Resolution Detected At",
] as const;
const ACTION_SYNC_HEADERS = [
  "External Source",
  "External Record ID",
  "Requirement Key",
  "Upload Link",
  "Source Status",
  "Last Source Check",
  "Sync Lifecycle",
] as const;
const RESOLVED_SOURCE_STATUSES = new Set([
  "accepted",
  "complete",
  "completed",
  "not applicable",
  "not required",
  "resolved",
  "verified",
]);
const IN_SCOPE_VALUES = new Set(["in scope", "tribe direct", "tribe downline"]);
const TERMINAL_STATUSES = new Set([
  "Complete",
  "Not Applicable",
  "Cancelled",
  "Closed",
  "Archived",
]);

const ACTION_STATUSES = new Set([
  "Not Started",
  "Open",
  "In Progress",
  "Waiting",
  "Review Required",
  "Blocked",
  "On Hold",
  ...TERMINAL_STATUSES,
]);

export interface WorkspaceAction {
  id: string;
  priority: string;
  affectedRecord: string;
  recordType: string;
  action: string;
  owner: string;
  dueDate: string;
  status: string;
  blocker: string;
  dateStatus: string;
  externalSource: string;
  externalRecordId: string;
  requirementKey: string;
  uploadUrl: string;
  sourceStatus: string;
  sourceCheckedAt: string;
  syncLifecycle: string;
}

export interface WorkspacePayload {
  contacts: Contact[];
  actions: WorkspaceAction[];
  syncedAt: string;
}

function spreadsheetId(): string {
  const value = process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim();
  if (!value) {
    throw new Error("Google Sheets workspace is not configured.");
  }
  return value;
}

let workspaceSchemaPromise: Promise<void> | null = null;

async function accessToken(): Promise<string> {
  const auth = new GoogleAuth({ scopes: [SHEETS_SCOPE] });
  const token = await auth.getAccessToken();
  if (!token) throw new Error("Could not authenticate to Google Sheets.");
  return token;
}

async function sheetsRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = await accessToken();
  const separator = path.startsWith(":") || path.startsWith("?") ? "" : "/";
  const response = await fetch(
    `${SHEETS_BASE_URL}/${encodeURIComponent(spreadsheetId())}${separator}${path}`,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
      cache: "no-store",
    },
  );
  if (!response.ok) {
    const detail = await response.text();
    console.error("Google Sheets request failed", response.status, detail);
    throw new Error("The Command Center sheet is temporarily unavailable.");
  }
  return response.json() as Promise<T>;
}

function value(row: unknown[], index: number): string {
  const cell = row[index];
  return cell == null ? "" : String(cell).trim();
}

function normalized(valueToNormalize: string): string {
  return valueToNormalize.trim().toLowerCase();
}

function isResolvedSourceStatus(status: string): boolean {
  return RESOLVED_SOURCE_STATUSES.has(normalized(status));
}

function isInScope(scopeStatus: string): boolean {
  return IN_SCOPE_VALUES.has(normalized(scopeStatus));
}

function safeHttpUrl(candidate: string): string {
  if (!candidate) return "";
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : "";
  } catch {
    return "";
  }
}

function sabActionId(sourceRecordId: string, requirementKey: string): string {
  const digest = createHash("sha256")
    .update(`${sourceRecordId}\u0000${requirementKey}`)
    .digest("hex")
    .slice(0, 12)
    .toUpperCase();
  return `ACT-SAB-${digest}`;
}

export function sabActionReconciliationDecision({
  previousActionStatus,
  previousSourceStatus,
  sourceStatus,
}: {
  previousActionStatus: string;
  previousSourceStatus: string;
  sourceStatus: string;
}): { nextActionStatus: string; syncLifecycle: string } {
  if (isResolvedSourceStatus(sourceStatus)) {
    return {
      nextActionStatus: "Complete",
      syncLifecycle: "Resolved automatically",
    };
  }
  if (isResolvedSourceStatus(previousSourceStatus)) {
    return {
      nextActionStatus: "Review Required",
      syncLifecycle: "Source reopened; review required",
    };
  }
  if (TERMINAL_STATUSES.has(previousActionStatus)) {
    return {
      nextActionStatus: previousActionStatus,
      syncLifecycle: "Pending at source; action remains manually closed",
    };
  }
  return {
    nextActionStatus: previousActionStatus,
    syncLifecycle: "Managed",
  };
}

function headerState(
  actual: unknown[] | undefined,
  expected: readonly string[],
): "blank" | "match" | "conflict" {
  const cells = Array.from(
    { length: expected.length },
    (_, index) => value(actual ?? [], index),
  );
  if (cells.every((cell) => !cell)) return "blank";
  if (cells.every((cell, index) => cell === expected[index])) return "match";
  return "conflict";
}

async function ensureWorkspaceSchemaOnce(): Promise<void> {
  const metadata = await sheetsRequest<{
    sheets?: Array<{
      properties?: {
        sheetId?: number;
        title?: string;
        index?: number;
        gridProperties?: { columnCount?: number };
      };
    }>;
  }>("?fields=sheets.properties(sheetId,title,index,gridProperties.columnCount)");
  const sheets = metadata.sheets ?? [];
  const openActions = sheets.find(
    (sheet) => sheet.properties?.title === "Open Actions",
  )?.properties;
  if (openActions?.sheetId == null) {
    throw new Error("The Open Actions sheet is missing.");
  }
  const openActionColumnCount = openActions.gridProperties?.columnCount ?? 0;
  const mirror = sheets.find(
    (sheet) => sheet.properties?.title === SAB_MIRROR_SHEET,
  )?.properties;

  const canReadActionHeaders = openActionColumnCount >= 40;
  const headerRanges: string[] = [];
  if (canReadActionHeaders) headerRanges.push("'Open Actions'!AH3:AN3");
  if (mirror) headerRanges.push(`'${SAB_MIRROR_SHEET}'!A3:S3`);
  const headerQuery = headerRanges
    .map((range) => `ranges=${encodeURIComponent(range)}`)
    .join("&");
  const headerResult = headerRanges.length
    ? await sheetsRequest<{
        valueRanges?: Array<{ values?: unknown[][] }>;
      }>(
        `values:batchGet?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE&${headerQuery}`,
      )
    : { valueRanges: [] };
  let headerResultIndex = 0;
  const actionHeaderState = canReadActionHeaders
    ? headerState(
        headerResult.valueRanges?.[headerResultIndex++]?.values?.[0],
        ACTION_SYNC_HEADERS,
      )
    : "blank";
  const mirrorHeaderState = mirror
    ? headerState(
        headerResult.valueRanges?.[headerResultIndex]?.values?.[0],
        SAB_MIRROR_HEADERS,
      )
    : "blank";

  if (actionHeaderState === "conflict") {
    throw new Error(
      "Open Actions AH:AN contains unexpected data; the SAB sync was not enabled.",
    );
  }
  if (mirrorHeaderState === "conflict") {
    throw new Error(
      `${SAB_MIRROR_SHEET} has an unexpected schema; the SAB sync was not enabled.`,
    );
  }
  if (
    mirror &&
    actionHeaderState === "match" &&
    mirrorHeaderState === "match"
  ) {
    return;
  }

  const requests: Array<Record<string, unknown>> = [];
  if (openActionColumnCount < 40) {
    requests.push({
      appendDimension: {
        sheetId: openActions.sheetId,
        dimension: "COLUMNS",
        length: 40 - openActionColumnCount,
      },
    });
  }
  let mirrorSheetId = mirror?.sheetId;
  if (mirrorSheetId == null) {
    const usedIds = sheets
      .map((sheet) => sheet.properties?.sheetId)
      .filter((sheetId): sheetId is number => sheetId != null);
    mirrorSheetId = (usedIds.length ? Math.max(...usedIds) : 0) + 1;
    requests.push({
      addSheet: {
        properties: {
          sheetId: mirrorSheetId,
          title: SAB_MIRROR_SHEET,
          index: sheets.length,
          gridProperties: { rowCount: 1000, columnCount: 19 },
        },
      },
    });
    requests.push({
      copyPaste: {
        source: {
          sheetId: openActions.sheetId,
          startRowIndex: 0,
          endRowIndex: 3,
          startColumnIndex: 0,
          endColumnIndex: 19,
        },
        destination: {
          sheetId: mirrorSheetId,
          startRowIndex: 0,
          endRowIndex: 3,
          startColumnIndex: 0,
          endColumnIndex: 19,
        },
        pasteType: "PASTE_FORMAT",
      },
    });
    requests.push(
      {
        updateSheetProperties: {
          properties: {
            sheetId: mirrorSheetId,
            gridProperties: { frozenRowCount: 3 },
          },
          fields: "gridProperties.frozenRowCount",
        },
      },
      {
        updateDimensionProperties: {
          range: {
            sheetId: mirrorSheetId,
            dimension: "COLUMNS",
            startIndex: 0,
            endIndex: 19,
          },
          properties: { pixelSize: 150 },
          fields: "pixelSize",
        },
      },
      {
        setBasicFilter: {
          filter: {
            range: {
              sheetId: mirrorSheetId,
              startRowIndex: 2,
              endRowIndex: 1000,
              startColumnIndex: 0,
              endColumnIndex: 19,
            },
          },
        },
      },
      {
        addProtectedRange: {
          protectedRange: {
            range: {
              sheetId: mirrorSheetId,
              startRowIndex: 0,
              endRowIndex: 1000,
              startColumnIndex: 0,
              endColumnIndex: 19,
            },
            description:
              "Managed by the TriBe downline read-only synchronization.",
            warningOnly: true,
          },
        },
      },
    );
  }

  if (actionHeaderState === "blank") {
    requests.push(
      {
        copyPaste: {
          source: {
            sheetId: openActions.sheetId,
            startRowIndex: 2,
            endRowIndex: 3,
            startColumnIndex: 32,
            endColumnIndex: 33,
          },
          destination: {
            sheetId: openActions.sheetId,
            startRowIndex: 2,
            endRowIndex: 3,
            startColumnIndex: 33,
            endColumnIndex: 40,
          },
          pasteType: "PASTE_FORMAT",
        },
      },
      {
        updateCells: {
          range: {
            sheetId: openActions.sheetId,
            startRowIndex: 2,
            endRowIndex: 3,
            startColumnIndex: 33,
            endColumnIndex: 40,
          },
          rows: [
            {
              values: ACTION_SYNC_HEADERS.map((header) => ({
                userEnteredValue: { stringValue: header },
              })),
            },
          ],
          fields: "userEnteredValue",
        },
      },
    );
  }

  if (!mirror || mirrorHeaderState === "blank") {
    requests.push({
      updateCells: {
        range: {
          sheetId: mirrorSheetId,
          startRowIndex: 0,
          endRowIndex: 3,
          startColumnIndex: 0,
          endColumnIndex: 19,
        },
        rows: [
          {
            values: [
              {
                userEnteredValue: {
                  stringValue:
                    "SAB Read-Only Mirror — TriBe downline requirements",
                },
              },
              ...Array.from({ length: 18 }, () => ({})),
            ],
          },
          {
            values: [
              {
                userEnteredValue: {
                  stringValue:
                    "One stable row per SAB requirement. Only confirmed TriBe direct agents and downline agencies are in scope. Unknown relationships go to Human Review.",
                },
              },
              ...Array.from({ length: 18 }, () => ({})),
            ],
          },
          {
            values: SAB_MIRROR_HEADERS.map((header) => ({
              userEnteredValue: { stringValue: header },
            })),
          },
        ],
        fields: "userEnteredValue",
      },
    });
  }

  if (requests.length) {
    await sheetsRequest(":batchUpdate", {
      method: "POST",
      body: JSON.stringify({ requests }),
    });
  }
}

export async function ensureWorkspaceSchema(): Promise<void> {
  if (!workspaceSchemaPromise) {
    workspaceSchemaPromise = ensureWorkspaceSchemaOnce().catch((error) => {
      workspaceSchemaPromise = null;
      throw error;
    });
  }
  return workspaceSchemaPromise;
}

function contactGroup(recordType: string): string {
  if (recordType === "Downline agency") return "Agencies";
  if (recordType === "TriBe") return "TriBe";
  return "Agents";
}

function priorityRank(priority: string): number {
  return { Urgent: 0, High: 1, Normal: 2, Low: 3 }[priority] ?? 4;
}

function activeActions(rows: unknown[][]): WorkspaceAction[] {
  return rows
    .filter((row) => value(row, 0) && !TERMINAL_STATUSES.has(value(row, 7)))
    .map((row) => ({
      id: value(row, 0),
      priority: value(row, 1),
      affectedRecord: value(row, 2),
      recordType: value(row, 3),
      action: value(row, 4),
      owner: value(row, 5),
      dueDate: value(row, 6),
      status: value(row, 7),
      blocker: value(row, 8),
      dateStatus: value(row, 17),
      externalSource: value(row, 33),
      externalRecordId: value(row, 34),
      requirementKey: value(row, 35),
      uploadUrl: safeHttpUrl(value(row, 36)),
      sourceStatus: value(row, 37),
      sourceCheckedAt: value(row, 38),
      syncLifecycle: value(row, 39),
    }))
    .sort((a, b) => {
      const priorityDelta =
        priorityRank(a.priority) - priorityRank(b.priority);
      if (priorityDelta) return priorityDelta;
      return (a.dueDate || "9999-12-31").localeCompare(
        b.dueDate || "9999-12-31",
      );
    });
}

function syncActivityValues({
  actionId,
  affectedRecord,
  recordType,
  previousStatus,
  nextStatus,
  timestamp,
  oldVersion,
  newVersion,
}: {
  actionId: string;
  affectedRecord: string;
  recordType: string;
  previousStatus: string;
  nextStatus: string;
  timestamp: string;
  oldVersion: number;
  newVersion: number;
}): unknown[] {
  return [
    `SAB-${actionId}-${Date.now()}-${newVersion}`,
    timestamp,
    affectedRecord,
    recordType,
    previousStatus,
    nextStatus,
    `Action ${actionId} reconciled from the SAB read-only mirror`,
    "",
    "",
    "",
    nextStatus === "Complete" ? "No" : "Yes",
    "Action Status",
    "SAB sync",
    "Read-only mirror",
    "Stable requirement-key reconciliation",
    "",
    nextStatus === "Complete" ? "Resolved at source" : "Reopened at source",
    "Automatic",
    nextStatus === "Complete" ? "Completed" : "Reopened",
    "",
    oldVersion,
    newVersion,
  ];
}

async function reconcileSabMirrorActions(): Promise<void> {
  const ranges = [
    `'${SAB_MIRROR_SHEET}'!A4:S1000`,
    "'Open Actions'!A4:AN1000",
    "'Activity Log'!A4:V1002",
  ];
  const query = ranges
    .map((range) => `ranges=${encodeURIComponent(range)}`)
    .join("&");
  const result = await sheetsRequest<{
    valueRanges?: Array<{ values?: unknown[][] }>;
  }>(
    `values:batchGet?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE&${query}`,
  );
  const mirrorRows = result.valueRanges?.[0]?.values ?? [];
  const actionRows = result.valueRanges?.[1]?.values ?? [];
  const logRows = result.valueRanges?.[2]?.values ?? [];
  const writes: Array<{ range: string; values: unknown[][] }> = [];
  let nextActionRow =
    Math.max(
      actionRows.reduce(
        (last, row, index) => (value(row, 0) ? index + 4 : last),
        3,
      ),
      3,
    ) + 1;
  let nextLogRow =
    Math.max(
      logRows.reduce(
        (last, row, index) => (value(row, 0) ? index + 4 : last),
        3,
      ),
      3,
    ) + 1;
  const now = new Date();
  const timestamp = chicagoDateTime(now);
  const completionDate = now.toISOString().slice(0, 10);

  const findAction = (
    sourceSystem: string,
    sourceRecordId: string,
    requirementKey: string,
    expectedActionId: string,
  ) =>
    actionRows.findIndex(
      (row) =>
        value(row, 0) === expectedActionId ||
        (normalized(value(row, 33)) === normalized(sourceSystem) &&
          value(row, 34) === sourceRecordId &&
          value(row, 35) === requirementKey),
    );

  for (let mirrorIndex = 0; mirrorIndex < mirrorRows.length; mirrorIndex += 1) {
    const row = mirrorRows[mirrorIndex];
    const mirrorSheetRow = mirrorIndex + 4;
    const sourceSystem = value(row, 0) || "SAB";
    const sourceRecordId = value(row, 1);
    const requirementKey = value(row, 2);
    const affectedRecord = value(row, 3);
    const recordType = value(row, 4);
    const scopeStatus = value(row, 6);
    const requirement = value(row, 7);
    const nextRequiredAction =
      value(row, 8) || (requirement ? `Provide ${requirement}` : "");
    const sourceStatus = value(row, 9);
    const actionOwner = value(row, 10);
    const dueDate = value(row, 11);
    const uploadUrl = safeHttpUrl(value(row, 12));
    const sourceRecordUrl = safeHttpUrl(value(row, 13));
    const sourceUpdatedAt = value(row, 14);
    const existingResolutionAt = value(row, 18);

    if (!sourceRecordId || !requirementKey || !affectedRecord || !sourceStatus) {
      if (row.some((cell) => value([cell], 0))) {
        writes.push({
          range: `'${SAB_MIRROR_SHEET}'!P${mirrorSheetRow}:R${mirrorSheetRow}`,
          values: [[timestamp, value(row, 16), "Human review: required fields missing"]],
        });
      }
      continue;
    }
    if (!isInScope(scopeStatus)) {
      writes.push({
        range: `'${SAB_MIRROR_SHEET}'!P${mirrorSheetRow}:R${mirrorSheetRow}`,
        values: [[timestamp, value(row, 16), "Ignored: record is not confirmed in scope"]],
      });
      continue;
    }

    const actionId = sabActionId(sourceRecordId, requirementKey);
    const actionIndex = findAction(
      sourceSystem,
      sourceRecordId,
      requirementKey,
      actionId,
    );
    const resolved = isResolvedSourceStatus(sourceStatus);

    if (actionIndex < 0) {
      if (resolved) {
        writes.push({
          range: `'${SAB_MIRROR_SHEET}'!P${mirrorSheetRow}:S${mirrorSheetRow}`,
          values: [[
            timestamp,
            "",
            "Resolved at source; no action required",
            existingResolutionAt || timestamp,
          ]],
        });
        continue;
      }

      const newAction = Array.from({ length: 40 }, () => "");
      newAction[0] = actionId;
      newAction[1] = normalized(sourceStatus) === "rejected" ? "High" : "Normal";
      newAction[2] = affectedRecord;
      newAction[3] = recordType;
      newAction[4] = nextRequiredAction;
      newAction[5] = actionOwner;
      newAction[6] = dueDate;
      newAction[7] = "Open";
      newAction[8] =
        normalized(sourceStatus) === "rejected"
          ? `${requirement || "Requirement"} was rejected at the source.`
          : "";
      newAction[10] = sourceSystem;
      newAction[11] = sourceUpdatedAt;
      newAction[12] = sourceRecordUrl;
      newAction[13] = "Yes";
      newAction[14] =
        "Managed from the SAB read-only mirror using a stable requirement key.";
      newAction[16] = timestamp;
      newAction[19] = "SAB sync";
      newAction[20] = sourceUpdatedAt;
      newAction[21] = sourceSystem;
      newAction[23] = sourceRecordUrl;
      newAction[26] = "Pending";
      newAction[27] = timestamp;
      newAction[28] = "SAB sync";
      newAction[32] = "1";
      newAction[33] = sourceSystem;
      newAction[34] = sourceRecordId;
      newAction[35] = requirementKey;
      newAction[36] = uploadUrl;
      newAction[37] = sourceStatus;
      newAction[38] = sourceUpdatedAt || timestamp;
      newAction[39] = "Managed";
      writes.push({
        range: `'Open Actions'!A${nextActionRow}:AN${nextActionRow}`,
        values: [newAction],
      });
      writes.push({
        range: `'${SAB_MIRROR_SHEET}'!P${mirrorSheetRow}:S${mirrorSheetRow}`,
        values: [[timestamp, actionId, "Created linked action", ""]],
      });
      actionRows.push(newAction);
      nextActionRow += 1;
      continue;
    }

    const action = actionRows[actionIndex];
    const actionSheetRow = actionIndex + 4;
    const previousActionStatus = value(action, 7);
    const previousSourceStatus = value(action, 37);
    const oldVersion = Number(value(action, 32)) || 0;
    const { nextActionStatus, syncLifecycle } =
      sabActionReconciliationDecision({
        previousActionStatus,
        previousSourceStatus,
        sourceStatus,
      });

    writes.push(
      {
        range: `'Open Actions'!E${actionSheetRow}:G${actionSheetRow}`,
        values: [[nextRequiredAction, actionOwner, dueDate]],
      },
      {
        range: `'Open Actions'!Q${actionSheetRow}`,
        values: [[timestamp]],
      },
      {
        range: `'Open Actions'!AH${actionSheetRow}:AN${actionSheetRow}`,
        values: [[
          sourceSystem,
          sourceRecordId,
          requirementKey,
          uploadUrl,
          sourceStatus,
          sourceUpdatedAt || timestamp,
          syncLifecycle,
        ]],
      },
    );

    if (nextActionStatus !== previousActionStatus) {
      const newVersion = oldVersion + 1;
      writes.push(
        {
          range: `'Open Actions'!H${actionSheetRow}`,
          values: [[nextActionStatus]],
        },
        {
          range: `'Open Actions'!N${actionSheetRow}`,
          values: [[nextActionStatus === "Complete" ? "No" : "Yes"]],
        },
        {
          range: `'Open Actions'!AB${actionSheetRow}:AE${actionSheetRow}`,
          values: [[
            timestamp,
            "SAB sync",
            nextActionStatus === "Complete" ? completionDate : "",
            nextActionStatus === "Complete" ? "SAB sync" : "",
          ]],
        },
        {
          range: `'Open Actions'!AG${actionSheetRow}`,
          values: [[newVersion]],
        },
        {
          range: `'Activity Log'!A${nextLogRow}:V${nextLogRow}`,
          values: [
            syncActivityValues({
              actionId: value(action, 0),
              affectedRecord,
              recordType,
              previousStatus: previousActionStatus,
              nextStatus: nextActionStatus,
              timestamp,
              oldVersion,
              newVersion,
            }),
          ],
        },
      );
      action[7] = nextActionStatus;
      action[32] = newVersion;
      nextLogRow += 1;
    }

    writes.push({
      range: `'${SAB_MIRROR_SHEET}'!P${mirrorSheetRow}:S${mirrorSheetRow}`,
      values: [[
        timestamp,
        value(action, 0),
        syncLifecycle,
        resolved ? existingResolutionAt || timestamp : "",
      ]],
    });
  }

  if (writes.length) {
    await sheetsRequest("values:batchUpdate", {
      method: "POST",
      body: JSON.stringify({
        valueInputOption: "USER_ENTERED",
        data: writes,
      }),
    });
  }
}

export async function upsertSabMirrorRows(
  inputs: SabMirrorInput[],
): Promise<{ inserted: number; updated: number }> {
  await ensureWorkspaceSchema();
  const result = await sheetsRequest<{ values?: unknown[][] }>(
    `values/${encodeURIComponent(`'${SAB_MIRROR_SHEET}'!A4:S1000`)}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`,
  );
  const existingRows = result.values ?? [];
  const rowByKey = new Map<string, number>();
  let lastUsedRow = 3;
  existingRows.forEach((row, index) => {
    const sheetRow = index + 4;
    if (row.some((cell) => value([cell], 0))) lastUsedRow = sheetRow;
    const source = value(row, 0);
    const recordId = value(row, 1);
    const requirementKey = value(row, 2);
    if (source && recordId && requirementKey) {
      rowByKey.set(
        `${normalized(source)}\u0000${recordId}\u0000${requirementKey}`,
        sheetRow,
      );
    }
  });

  const writes: Array<{ range: string; values: unknown[][] }> = [];
  let inserted = 0;
  let updated = 0;
  for (const input of inputs) {
    const key = `${normalized(input.sourceSystem)}\u0000${input.sourceRecordId}\u0000${input.requirementKey}`;
    let sheetRow = rowByKey.get(key);
    if (sheetRow == null) {
      lastUsedRow += 1;
      sheetRow = lastUsedRow;
      rowByKey.set(key, sheetRow);
      inserted += 1;
    } else {
      updated += 1;
    }
    writes.push({
      range: `'${SAB_MIRROR_SHEET}'!A${sheetRow}:O${sheetRow}`,
      values: [[
        input.sourceSystem,
        input.sourceRecordId,
        input.requirementKey,
        input.affectedRecord,
        input.recordType,
        input.parentAgency,
        input.scopeStatus,
        input.requirement,
        input.nextRequiredAction,
        input.requirementStatus,
        input.actionOwner,
        input.targetFollowUpDate,
        safeHttpUrl(input.uploadUrl),
        safeHttpUrl(input.sourceRecordUrl),
        input.sourceUpdatedAt,
      ]],
    });
  }

  if (writes.length) {
    await sheetsRequest("values:batchUpdate", {
      method: "POST",
      body: JSON.stringify({ valueInputOption: "USER_ENTERED", data: writes }),
    });
    await reconcileSabMirrorActions();
  }
  return { inserted, updated };
}

export async function getWorkspace(): Promise<WorkspacePayload> {
  await ensureWorkspaceSchema();
  await reconcileSabMirrorActions();
  const ranges = [
    "'People & Agencies'!A4:P1000",
    "'Open Actions'!A4:AN1000",
  ];
  const query = ranges
    .map((range) => `ranges=${encodeURIComponent(range)}`)
    .join("&");
  const result = await sheetsRequest<{
    valueRanges?: Array<{ values?: unknown[][] }>;
  }>(`values:batchGet?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE&${query}`);
  const peopleRows = result.valueRanges?.[0]?.values ?? [];
  const actionRows = result.valueRanges?.[1]?.values ?? [];

  const contacts = peopleRows
    .map((row): Contact | null => {
      const id = value(row, 0);
      const name = value(row, 1);
      const phone = normalizePhone(value(row, 9));
      if (!id || !name || !phone) return null;
      return {
        id: `sheet:${id}`,
        recordId: id,
        name,
        phone,
        email: value(row, 8),
        group: contactGroup(value(row, 2)),
        source: "sheet",
      };
    })
    .filter((contact): contact is Contact => Boolean(contact))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    contacts,
    actions: activeActions(actionRows),
    syncedAt: new Date().toISOString(),
  };
}

function chicagoDateTime(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")} ${part("timeZoneName")}`;
}

export async function updateWorkspaceAction(
  actionId: string,
  status: string,
): Promise<void> {
  if (!/^ACT-[A-Z0-9-]+$/i.test(actionId) || !ACTION_STATUSES.has(status)) {
    throw new Error("Invalid action update.");
  }

  const query = [
    "'Open Actions'!A4:AN1000",
    "'Activity Log'!A4:V1002",
  ]
    .map((range) => `ranges=${encodeURIComponent(range)}`)
    .join("&");
  const result = await sheetsRequest<{
    valueRanges?: Array<{ values?: unknown[][] }>;
  }>(`values:batchGet?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE&${query}`);
  const actionRows = result.valueRanges?.[0]?.values ?? [];
  const logRows = result.valueRanges?.[1]?.values ?? [];
  const actionIndex = actionRows.findIndex((row) => value(row, 0) === actionId);
  if (actionIndex < 0) throw new Error("Action not found.");

  const row = actionRows[actionIndex];
  const previousStatus = value(row, 7);
  if (previousStatus === status) return;

  const sheetRow = actionIndex + 4;
  const logRow = logRows.findIndex((row) => !value(row, 0)) + 4;
  const nextLogRow = logRow >= 4 ? logRow : logRows.length + 4;
  const now = new Date();
  const timestamp = chicagoDateTime(now);
  const completionDate = status === "Complete"
    ? now.toISOString().slice(0, 10)
    : "";
  const oldVersion = Number(value(row, 32)) || 0;
  const newVersion = oldVersion + 1;
  const updateActor = "Shawn";

  const logValues = [
    `PHONE-${now.getTime()}`,
    timestamp,
    value(row, 2),
    value(row, 3),
    previousStatus,
    status,
    `Action ${actionId} updated from Tribe Harbor Phone`,
    "",
    "",
    "",
    status === "Complete" ? "No" : "Yes",
    "Action Status",
    updateActor,
    "Phone app",
    "Quick action from Tribe Harbor Phone",
    "",
    status === "Complete" ? "Marked done" : "Reopened",
    "Manual",
    status === "Complete" ? "Completed" : "Reopened",
    "",
    oldVersion,
    newVersion,
  ];

  const data: Array<{ range: string; values: unknown[][] }> = [
    { range: `'Open Actions'!H${sheetRow}`, values: [[status]] },
    { range: `'Open Actions'!AB${sheetRow}:AE${sheetRow}`, values: [[
      timestamp,
      updateActor,
      completionDate,
      status === "Complete" ? updateActor : "",
    ]] },
    { range: `'Open Actions'!AG${sheetRow}`, values: [[newVersion]] },
    {
      range: `'Activity Log'!A${nextLogRow}:V${nextLogRow}`,
      values: [logValues],
    },
  ];
  if (value(row, 33) && status === "Complete") {
    data.push({
      range: `'Open Actions'!AN${sheetRow}`,
      values: [["Manually closed; awaiting source confirmation"]],
    });
  }

  await sheetsRequest("values:batchUpdate", {
    method: "POST",
    body: JSON.stringify({
      valueInputOption: "USER_ENTERED",
      data,
    }),
  });
}
