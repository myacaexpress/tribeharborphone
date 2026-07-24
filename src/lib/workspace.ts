import { GoogleAuth } from "google-auth-library";
import { normalizePhone, type Contact } from "./contacts";

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const SHEETS_BASE_URL = "https://sheets.googleapis.com/v4/spreadsheets";
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
  const response = await fetch(
    `${SHEETS_BASE_URL}/${encodeURIComponent(spreadsheetId())}/${path}`,
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

export async function getWorkspace(): Promise<WorkspacePayload> {
  const ranges = [
    "'People & Agencies'!A4:P1000",
    "'Open Actions'!A4:R1000",
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
    "'Open Actions'!A4:AG1000",
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

  await sheetsRequest("values:batchUpdate", {
    method: "POST",
    body: JSON.stringify({
      valueInputOption: "USER_ENTERED",
      data: [
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
      ],
    }),
  });
}
