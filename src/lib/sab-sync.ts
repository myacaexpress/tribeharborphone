import {
  isSabSyncEnabled,
  readSabMirrorInputs,
} from "./sab-highlevel";
import { upsertSabMirrorRows } from "./workspace";

export async function synchronizeSabMirror(): Promise<
  | { status: "disabled" }
  | { status: "ok"; records: number; inserted: number; updated: number }
> {
  if (!isSabSyncEnabled()) return { status: "disabled" };
  const inputs = await readSabMirrorInputs();
  const result = await upsertSabMirrorRows(inputs);
  return {
    status: "ok",
    records: inputs.length,
    ...result,
  };
}
