"use client";

import { useEffect, useState } from "react";
import type { ProviderId, Task } from "@proofmarket/shared/src/types";
import { AuditSidebar } from "../components/AuditSidebar";
import { ModeBadge } from "../components/ModeBadge";
import { Stepper } from "../components/Stepper";
import { StepShell } from "../components/StepShell";
import { Step1Question } from "../components/steps/Step1Question";
import { Step2Plan } from "../components/steps/Step2Plan";
import { Step3Authorize } from "../components/steps/Step3Authorize";
import { Step4Onchain } from "../components/steps/Step4Onchain";
import { Step5Evidence } from "../components/steps/Step5Evidence";
import { Step6Done } from "../components/steps/Step6Done";
import { STEPS, stepFor } from "../lib/steps";

type ActionName =
  | "plan"
  | "pact"
  | "pact-status"
  | "execute"
  | "provider"
  | "verify"
  | "settle"
  | "denial-demo"
  | "open-challenge"
  | "challenge-win"
  | "refund-or-slash";

const polledActions: ReadonlySet<string> = new Set([
  "execute",
  "provider",
  "settle",
  "open-challenge",
  "refund-or-slash"
]);

async function readTaskResponse(response: Response): Promise<Task> {
  const text = await response.text();
  let payload: unknown = null;

  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error?: unknown }).error)
        : text || `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return payload as Task;
}

export default function Page() {
  const [task, setTask] = useState<Task | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  // A done step the user clicked to review read-only; null = follow the task.
  const [viewStep, setViewStep] = useState<number | null>(null);
  // Provider the user picked from the step-2 shortlist; drives the provider
  // call in step 4. Null = fall back to the agent's recommendation.
  const [selectedProviderId, setSelectedProviderId] = useState<ProviderId | null>(null);
  // Whether to expand the audit sidebar (for the 「查看完整审计」button).
  const [auditExpanded, setAuditExpanded] = useState(true);
  const isBusy = busyAction !== null;
  const taskId = task?.id ?? null;

  // While a slow on-chain action runs, poll the task so incrementally saved
  // txRecords show up. The cleanup runs when busyAction changes (the POST
  // response stays the final word) and on unmount.
  useEffect(() => {
    if (!taskId || !busyAction || !polledActions.has(busyAction)) return;

    let cancelled = false;
    const interval = setInterval(async () => {
      try {
        const response = await fetch(`/api/tasks/${taskId}`);
        if (!response.ok) return;
        const polled = (await response.json()) as Task;
        if (!cancelled) setTask(polled);
      } catch {
        // Polling is best-effort; the POST in flight reports real errors.
      }
    }, 2000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [busyAction, taskId]);

  // Resume an in-flight task after a page reload: /?taskId=task_002 loads the
  // server-side task state and re-enters the wizard at the matching step.
  // Wizard state is otherwise client-only, so without this a refresh (or a
  // crashed capture session) would strand a live on-chain task.
  useEffect(() => {
    const resumeId = new URLSearchParams(window.location.search).get("taskId");
    if (!resumeId) return;
    (async () => {
      try {
        const response = await fetch(`/api/tasks/${resumeId}`);
        if (response.ok) setTask((await response.json()) as Task);
      } catch {
        // Best-effort: a bad taskId just leaves the fresh-task screen.
      }
    })();
  }, []);

  async function createTask(question: string, budget: string) {
    if (isBusy) return;

    setError(null);
    setBusyAction("create");
    let createdId: string | null = null;

    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, budget })
      });
      const created = await readTaskResponse(response);
      createdId = created.id;
      setTask(created);

      // Auto-chain the pure-computation plan action so the user lands on
      // step 2 with the procurement plan ready (spec §二). On-chain actions
      // stay click-triggered.
      const planResponse = await fetch(`/api/tasks/${created.id}/plan`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({})
      });
      setTask(await readTaskResponse(planResponse));
      setViewStep(null);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to create task."
      );
      // If creation succeeded but planning failed, refetch so partial
      // progress (audit events) renders alongside the error strip.
      if (createdId) {
        try {
          const refetch = await fetch(`/api/tasks/${createdId}`);
          if (refetch.ok) setTask((await refetch.json()) as Task);
        } catch {
          // Best-effort: keep the existing task state if the refetch fails.
        }
      }
    } finally {
      setBusyAction(null);
    }
  }

  async function runAction(action: ActionName, body: unknown = {}) {
    if (isBusy || !task) return;

    setError(null);
    setBusyAction(action);

    try {
      const response = await fetch(`/api/tasks/${task.id}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      setTask(await readTaskResponse(response));
      setViewStep(null);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : `Unable to run ${action}.`
      );
      // The action failed, but the service may have persisted partial
      // progress (failed txRecords, audit events). Refetch once so the
      // failure artifacts render alongside the error strip.
      try {
        const refetch = await fetch(`/api/tasks/${task.id}`);
        if (refetch.ok) setTask((await refetch.json()) as Task);
      } catch {
        // Best-effort: keep the existing task state if the refetch fails.
      }
    } finally {
      setBusyAction(null);
    }
  }

  function resetTask() {
    setTask(null);
    setError(null);
    setBusyAction(null);
    setViewStep(null);
    setSelectedProviderId(null);
  }

  const currentStep = stepFor(task);
  // Review mode only goes backwards: a stale viewStep (>= current) is ignored.
  const displayStep =
    viewStep !== null && viewStep < currentStep ? viewStep : currentStep;
  const isReviewing = displayStep < currentStep;

  function renderStep() {
    switch (displayStep) {
      case 1:
        return (
          <Step1Question
            task={task}
            onCreate={createTask}
            isBusy={isBusy}
            readOnly={isReviewing}
          />
        );
      case 2:
        return (
          <Step2Plan
            task={task}
            onConfirm={(providerId) => {
              setSelectedProviderId(providerId);
              runAction("pact");
            }}
            isBusy={isBusy}
            readOnly={isReviewing}
          />
        );
      case 3:
        return (
          <Step3Authorize
            task={task}
            onExecute={() => runAction("execute")}
            onCheckApproval={() => runAction("pact-status")}
            onTriggerDenial={() => runAction("denial-demo")}
            isBusy={isBusy}
          />
        );
      case 4:
        return (
          <Step4Onchain
            task={task}
            onGetEvidence={() =>
              runAction("provider", {
                providerId:
                  selectedProviderId ?? task?.plan?.recommendedProviderId
              })
            }
            isBusy={isBusy}
          />
        );
      case 5:
        return (
          <Step5Evidence
            task={task}
            onVerify={() => runAction("verify")}
            onOpenChallenge={() => runAction("open-challenge")}
            onRequestVote={() => runAction("challenge-win")}
            onResolve={() => runAction("refund-or-slash")}
            isBusy={isBusy}
            readOnly={isReviewing}
          />
        );
      case 6:
        return (
          <Step6Done
            task={task}
            onSettle={() => runAction("settle")}
            onReset={resetTask}
            onOpenAudit={() => setAuditExpanded(true)}
            isBusy={isBusy}
          />
        );
      default: {
        const step = STEPS[displayStep - 1];
        return (
          <StepShell
            stepNo={step.no}
            title={`${step.title}（开发中）`}
            subtitle="该步骤的界面尚在开发中；后端流程不受影响。"
          >
            <div className="info-strip">
              第 {step.no} 步 · {step.title}（开发中）
            </div>
          </StepShell>
        );
      }
    }
  }

  return (
    <main className="wizard-shell" aria-busy={busyAction ? "true" : "false"}>
      <header className="wizard-header">
        <div className="brand-row">
          <span className="brand">ProofMarket</span>
          <ModeBadge task={task} />
        </div>
        <Stepper
          task={task}
          viewingStep={isReviewing ? displayStep : null}
          onSelectStep={(n) => setViewStep(n === currentStep ? null : n)}
        />
      </header>

      <div className="wizard-grid">
        <section className="wizard-main" aria-label="当前步骤">
          {error ? (
            <div className="error-strip" role="alert">
              请求出错：{error}
            </div>
          ) : null}

          {isReviewing ? (
            <div className="info-strip viewing-strip">
              <span>
                正在回看第 {displayStep} 步（只读），当前流程在第 {currentStep} 步。
              </span>
              <button
                type="button"
                className="secondary"
                onClick={() => setViewStep(null)}
              >
                回到当前步骤
              </button>
            </div>
          ) : null}

          {renderStep()}
        </section>

        <AuditSidebar
          task={task}
          expanded={auditExpanded}
          onToggle={setAuditExpanded}
        />
      </div>
    </main>
  );
}
