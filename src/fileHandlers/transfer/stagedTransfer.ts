// Confirmation layer of the Staged Transfer Workflow (Features 2+3): runs the
// staging walk behind a cancellable notification, shows the counts modal, and
// hands off to the Compare view for Review. Shared by folder staging (below)
// and the multi-file aggregation in ../multiFileTransfer.
//
// The guard is advisory, not transactional: files added or changed between the
// staging walk and the transfer re-walk move unconfirmed and uncounted, and an
// identical-classified file that changed in that window is wrongly skipped —
// the same TOCTOU stance as the single-file gate.

import * as path from 'path';
import app from '../../app';
import { FileSystem, FileType, TransferDirection } from '../../core';
import {
  executeCommand,
  showCancellableProgress,
  showInformationMessage,
  showModalChoices,
} from '../../host';
import { FileHandlerContext } from '../createFileHandler';
import { deriveCompareMtime } from '../compare';
import { FileHandleOption } from '../option';
import { StagePlan, stageFolderTransfer } from './stage';

// Thrown when the user picks Cancel in a multi-profile staged flow, meaning
// "cancel the remaining profiles too" — createFileMultiCommand catches it to
// stop the per-profile loop without reporting an error.
export class StagedTransferCancelledError extends Error {
  constructor() {
    super('staged transfer cancelled');
    this.name = 'StagedTransferCancelledError';
  }
}

export type StageDecision =
  | { action: 'proceed'; skipSet?: Set<string> }
  | { action: 'abort' }
  | { action: 'cancelRemaining' };

const REVIEW_LABEL = 'Review in Compare View';
const SKIP_PROFILE_LABEL = 'Skip This Profile';

function transferVerb(direction: TransferDirection): string {
  return direction === TransferDirection.LOCAL_TO_REMOTE ? 'Upload' : 'Download';
}

// "3 new, 2 will be overwritten (1 modified, 1 timestamp-only), 40 identical (skipped)."
// The timestamp-only breakdown is omitted on FTP, where TimeDiff cannot occur
// (size-only comparison basis).
function describeCounts(
  plan: StagePlan,
  skipUnmodified: boolean,
  compareMtime: boolean,
  reTransferVerb: string
): string {
  const { create, overwriteModified, overwriteTimeDiff, identical } = plan.counts;
  const overwrites = overwriteModified + overwriteTimeDiff;
  const parts = [`${create} new`];
  if (overwrites > 0) {
    const breakdown = compareMtime
      ? ` (${overwriteModified} modified, ${overwriteTimeDiff} timestamp-only)`
      : '';
    parts.push(`${overwrites} will be overwritten${breakdown}`);
  }
  if (identical > 0) {
    parts.push(`${identical} identical (${skipUnmodified ? 'skipped' : reTransferVerb})`);
  }
  return `${parts.join(', ')}.`;
}

// Decide what happens to a staged transfer: passive fast path, counts modal
// (Transfer / Review / Cancel — or the multi-profile variant), or silent
// proceed when only skipUnmodified is on. The caller owns applying the
// decision (setting _overwriteConfirmed/_skipSet or aborting).
export async function confirmStagePlan(args: {
  plan: StagePlan;
  direction: TransferDirection;
  confirmOverwrite: boolean;
  skipUnmodified: boolean;
  compareMtime: boolean;
  // e.g. "'src'" or "3 selected files" — already quoted/pluralized by the caller
  sourceLabel: string;
  // where the transfer lands, e.g. host:/var/www/src
  destinationLabel: string;
  // multi-profile flows get [Transfer]/[Skip This Profile]/built-in Cancel
  // (= cancel remaining) and never a Review button: compare-view actions
  // re-resolve their service against the ACTIVE profile, so Review inside a
  // multi-profile loop could silently transfer to the wrong server.
  multiProfileFlow: boolean;
}): Promise<StageDecision> {
  const { plan, direction, confirmOverwrite, skipUnmodified, compareMtime, multiProfileFlow } =
    args;

  const proceed = (): StageDecision => ({
    action: 'proceed',
    skipSet: skipUnmodified ? new Set(plan.identical) : undefined,
  });

  if (!confirmOverwrite) {
    // skipUnmodified alone stages silently — no modal, no toast
    return proceed();
  }

  const verb = transferVerb(direction);
  const reTransferVerb =
    direction === TransferDirection.LOCAL_TO_REMOTE ? 're-uploaded' : 're-downloaded';
  const { overwriteModified, overwriteTimeDiff, identical } = plan.counts;
  const overwrites = overwriteModified + overwriteTimeDiff;
  const summary = describeCounts(plan, skipUnmodified, compareMtime, reTransferVerb);

  // Zero-overwrite fast path — only when the transfer genuinely overwrites
  // nothing: no overwrite entries AND no identical files about to be silently
  // re-transferred (identical files DO transfer when skipUnmodified is off —
  // and on FTP "identical" is size-only, so that would be a data-loss path).
  if (overwrites === 0 && (skipUnmodified || identical === 0)) {
    showInformationMessage(`${verb} ${args.sourceLabel}: ${summary} Nothing overwritten.`);
    return proceed();
  }

  const message =
    `${verb} ${args.sourceLabel} to ${args.destinationLabel}\n\n${summary}`;
  const transferLabel = overwrites > 0 ? `Overwrite ${overwrites} & ${verb}` : verb;

  if (multiProfileFlow) {
    const choice = await showModalChoices(message, transferLabel, SKIP_PROFILE_LABEL);
    if (choice === transferLabel) {
      return proceed();
    }
    if (choice === SKIP_PROFILE_LABEL) {
      return { action: 'abort' };
    }
    return { action: 'cancelRemaining' };
  }

  const choice = app.compareExplorer
    ? await showModalChoices(message, transferLabel, REVIEW_LABEL)
    : await showModalChoices(message, transferLabel);
  if (choice === transferLabel) {
    return proceed();
  }
  if (choice === REVIEW_LABEL) {
    // Hand the classification to the Compare view and abort the transfer; the
    // user acts through the per-item/group actions (whose call sites already
    // suppress re-prompting) and resets with Clear. Identical pairs are not
    // representable as CompareEntry, so they never appear in Review and
    // Review-then-group-actions never re-transfers them — intended: Review
    // means "inspect and act on differences", modal-Transfer means "force this
    // exact state".
    app.compareExplorer.setResult(plan.result);
    executeCommand('sftpCompare.focus');
  }
  return { action: 'abort' };
}

// Stage a folder transfer end to end: cancellable classification walk, then
// the confirmation decision. Returns the decision; cancel of the walk aborts.
export async function stageAndConfirmFolderTransfer(
  ctx: FileHandlerContext,
  option: FileHandleOption & { _multiProfileFlow?: boolean },
  direction: TransferDirection,
  localFs: FileSystem,
  remoteFs: FileSystem
): Promise<StageDecision> {
  const { localFsPath, remoteFsPath } = ctx.target;
  const compareMtime = deriveCompareMtime(ctx.config);
  const sourceName = path.basename(
    direction === TransferDirection.LOCAL_TO_REMOTE ? localFsPath : remoteFsPath
  );

  const plan = await showCancellableProgress(
    `SFTP: checking '${sourceName}'`,
    (report, isCancelled) => {
      let seen = 0;
      return stageFolderTransfer({
        localFs,
        remoteFs,
        localFsPath,
        remoteFsPath,
        direction,
        ignore: option.ignore,
        compareMtime,
        serviceName: ctx.fileService.name,
        serviceId: ctx.fileService.id,
        originUri: ctx.target.localUri.toString(),
        concurrency: ctx.config.concurrency,
        control: {
          isCancelled,
          onFile() {
            seen += 1;
            report(`${seen} files checked`);
          },
        },
      });
    }
  );
  if (!plan) {
    // walk cancelled — discard the partial plan, transfer nothing
    return { action: 'abort' };
  }

  return confirmStagePlan({
    plan,
    direction,
    confirmOverwrite: Boolean(option.confirmOverwrite),
    skipUnmodified: Boolean(option.skipUnmodified),
    compareMtime,
    sourceLabel: `'${sourceName}'`,
    destinationLabel:
      direction === TransferDirection.LOCAL_TO_REMOTE
        ? `${ctx.config.host}:${remoteFsPath}`
        : localFsPath,
    multiProfileFlow: Boolean(option._multiProfileFlow),
  });
}

// Shared "is the source a directory?" probe for the staging hook. Failure to
// stat falls through (returns null) so the plain transfer path reports the
// real error.
export async function lstatTypeOrNull(fs: FileSystem, fsPath: string): Promise<FileType | null> {
  try {
    const stat = await fs.lstat(fsPath);
    return stat.type;
  } catch (error) {
    return null;
  }
}
