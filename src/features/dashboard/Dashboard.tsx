import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../../app/store';
import { Dialog } from '../../components/Dialog';
import { editAction, type EditAction } from '../../data/repository';
import { addDays, dateRange, formatDate, startOfWeek, weekday } from '../../domain/dates';
import { evaluate, formulas, weekdayName } from '../../domain/policies';
import { forecast } from '../../domain/projection';
import { simulatedEntries, strategyLabel, type Suggestion } from '../../domain/planning';
import { type PlanningResponse } from '../../app/planning.worker';

const stateLabel = {
  'not-started': 'Not started',
  gathering: 'Gathering history',
  initializing: 'Provisional progress',
  compliant: 'Meeting recorded requirement',
  shortfall: 'Recorded shortfall',
  invalid: 'Unable to evaluate',
};

export function Dashboard() {
  const { snapshot, today, edit, perform, saving, pending, error } = useStore();
  const [preview, setPreview] = useState<{
    suggestion: Suggestion;
    action: EditAction;
    revision: number;
    referenceDate: string;
    horizonEnd: string;
    strategies: Record<string, ReturnType<typeof strategyLabel>>;
  } | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [message, setMessage] = useState('');
  const workerRef = useRef<Worker | null>(null);
  useEffect(() => () => workerRef.current?.terminate(), []);
  const policy = snapshot?.dataset.policy;
  const domainSnapshot = useMemo(
    () => ({ policy, records: snapshot?.dataset.records ?? [], today }),
    [policy, snapshot, today],
  );
  const current = useMemo(
    () => evaluate(policy, domainSnapshot.records, today),
    [policy, domainSnapshot, today],
  );
  const projection = useMemo(() => forecast(domainSnapshot), [domainSnapshot]);
  if (!snapshot || !policy) return null;
  if (error)
    return (
      <section className="card">
        <h1>Unable to evaluate</h1>
        <p>
          Resolve the storage error above before relying on an attendance result or forecast.
          Unsaved changes are not included in stored history.
        </p>
      </section>
    );
  const currentStart = startOfWeek(today, policy.weekStart);
  const weekDates = dateRange(currentStart, addDays(currentStart, 6), false);
  const office = snapshot.dataset.records.filter(
    (entry) =>
      weekDates.includes(entry.date) &&
      entry.type === 'office' &&
      entry.status === 'actual' &&
      entry.date <= today &&
      entry.date >= policy.startDate,
  ).length;
  const pastPlans = snapshot.dataset.records
    .filter((entry) => entry.status === 'planned' && entry.date < today)
    .sort((a, b) => b.date.localeCompare(a.date));
  const affected = projection.firstAffected ?? projection.firstAdvisory;
  const protectedCount = snapshot.dataset.records.filter(
    (entry) => entry.priority === 'must' && entry.date >= today && entry.date <= projection.end,
  ).length;
  const blocked = saving || !!pending;
  const currentEntry = snapshot.dataset.records.find((entry) => entry.date === today);

  function findPlan() {
    setSearching(true);
    setSearchError('');
    try {
      const worker = new Worker(new URL('../../app/planning.worker.ts', import.meta.url), {
        type: 'module',
      });
      workerRef.current = worker;
      worker.onmessage = (event: MessageEvent<PlanningResponse>) => {
        const response = event.data;
        if (response.error !== undefined) setSearchError(response.error);
        else
          setPreview({
            suggestion: response.result,
            strategies: response.strategies,
            revision: snapshot!.revision,
            referenceDate: today,
            horizonEnd: projection.end,
            action: {
              ...editAction(
                snapshot!,
                simulatedEntries(response.result.dates).map((value) => ({
                  date: value.date,
                  value,
                })),
              ),
              expectedDatasetRevision: snapshot!.revision,
            },
          });
        setSearching(false);
        worker.terminate();
        workerRef.current = null;
      };
      worker.onerror = () => {
        setSearchError(
          'The planning worker could not start. Try again or plan directly in Calendar.',
        );
        setSearching(false);
        worker.terminate();
        workerRef.current = null;
      };
      worker.postMessage(domainSnapshot);
    } catch {
      setSearchError(
        'Unable to complete the planning search. No changes were made. Try again or plan directly in Calendar.',
      );
      setSearching(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">{formatDate(today, true).toUpperCase()}</p>
          <h1>Your office rhythm.</h1>
          <p className="muted">A clearer picture of where you are, and what comes next.</p>
        </div>
        <Link className="button primary" to="/calendar">
          Open calendar
        </Link>
      </div>
      <section className="card today-card">
        <div>
          <span className="eyebrow">TODAY'S CHECK-IN</span>
          <h2>
            {currentEntry
              ? `${currentEntry.type[0].toUpperCase()}${currentEntry.type.slice(1)} · ${currentEntry.status}`
              : 'Where are you working today?'}
          </h2>
          <p className="muted">Confirm actual attendance. Your future plans stay plans.</p>
        </div>
        <div className="button-row">
          {(['office', 'remote'] as const).map((type) => (
            <button
              key={type}
              className={`tool ${type}`}
              disabled={blocked || currentEntry?.priority === 'must'}
              onClick={async () => {
                if (
                  await edit([
                    {
                      date: today,
                      value: {
                        date: today,
                        type,
                        status: 'actual',
                        priority: currentEntry?.priority ?? 'normal',
                        notes: currentEntry?.notes ?? '',
                      },
                    },
                  ])
                )
                  setMessage('Today saved on this browser.');
              }}
            >
              {type === 'office' ? 'In the office' : 'Working remotely'}
            </button>
          ))}
          {currentEntry?.priority === 'must' && (
            <Link to="/calendar">Edit protected day in Calendar</Link>
          )}
        </div>
      </section>
      <div className="metrics">
        <section className="card metric">
          <span className="eyebrow">THIS WEEK · PROVISIONAL</span>
          <div className="metric-value">
            {office}
            <span> / {policy.kind === 'weekdays' ? policy.requiredDays.length : policy.n}</span>
          </div>
          <h2>Confirmed office days</h2>
          <div className="week-dots">
            {weekDates.map((date) => {
              const entry = snapshot.dataset.records.find((value) => value.date === date);
              return (
                <span
                  key={date}
                  className={entry?.type === 'office' ? 'filled' : ''}
                  title={`${formatDate(date)}: ${entry?.type ?? 'unknown'}`}
                  aria-label={`${weekdayName(weekday(date))}: ${entry?.type ?? 'unknown'}, ${entry?.status ?? 'unentered'}`}
                >
                  {weekdayName(weekday(date)).slice(0, 1)}
                </span>
              );
            })}
          </div>
          <p className="muted">
            Week of {formatDate(currentStart)}.{' '}
            {currentStart < current.firstEligible
              ? 'Initial partial week is informational only.'
              : 'Not part of formal completed-week status.'}
          </p>
        </section>
        <section className={`card metric status-${current.state}`}>
          <span className="eyebrow">RECORDED ATTENDANCE</span>
          <h2 className="status-title">{stateLabel[current.state]}</h2>
          {current.score ? (
            <p>
              <strong>
                {current.score.achieved} / {current.score.target}
              </strong>{' '}
              {current.score.unit}
            </p>
          ) : (
            <p>No completed-week score yet.</p>
          )}
          <p className="muted">{current.explanation}</p>
          {current.windowStart && (
            <p className="small">
              {formatDate(current.windowStart)} - {formatDate(current.windowEnd!)}
            </p>
          )}
        </section>
        <section className="card metric">
          <span className="eyebrow">YOUR COMMITMENTS</span>
          <div className="metric-value">{protectedCount}</div>
          <h2>Protected upcoming days</h2>
          <p className="muted">
            Must-priority commitments are preserved by suggestions. Protection does not waive your
            policy.
          </p>
          <Link to="/calendar">Shape your plan</Link>
        </section>
      </div>
      <section className={`card forecast-card status-${projection.state}`}>
        <div className="section-heading">
          <div>
            <p className="eyebrow">LOOKING AHEAD</p>
            <h2>{projection.explanation}</h2>
          </div>
          <span className="pill">Current + next {projection.horizonWeeks} weeks</span>
        </div>
        <p>
          Through <strong>{formatDate(projection.end)}</strong> only. This forecast is advisory, not
          employer-certified compliance.
        </p>
        <div className="scenario-grid">
          <div>
            <h3>Committed-plan case</h3>
            <p>
              Actual history plus explicit future office plans. Unknown dates add no office
              attendance.
            </p>
          </div>
          <div>
            <h3>Available-capacity case</h3>
            <p>
              Add every unknown future weekday, preserving explicit non-office plans, leave, and
              protected commitments.
            </p>
          </div>
        </div>
        {affected ? (
          <div className="notice">
            <h3>
              {affected.formal ? 'First affected checkpoint' : 'Upcoming provisional planning need'}
              : {formatDate(affected.end)}
            </h3>
            <p>
              Evaluation window: {formatDate(affected.committed.windowStart!)} -{' '}
              {formatDate(affected.committed.windowEnd!)}. {affected.committed.score?.achieved} of{' '}
              {affected.committed.score?.target} {affected.committed.score?.unit} committed.
            </p>
            <p>
              This week has {affected.committedDates.length} committed office days and{' '}
              {affected.availableDates.length} remaining unknown weekdays
              {affected.availableDates.length
                ? `: ${affected.availableDates.map(formatShort).join(', ')}`
                : '.'}
            </p>
            {!affected.capacity.score?.met && (
              <p>
                <strong>Capacity conflict:</strong> This checkpoint cannot be repaired just by
                filling unknown dates. Review historical missing confirmations and explicit plans;
                never add future days as a fix for a historical shortfall.
              </p>
            )}
            {affected.expiringWeeks.length > 0 && (
              <p>
                Qualifying week aging out: {affected.expiringWeeks.map(formatShort).join(', ')}.
              </p>
            )}
          </div>
        ) : (
          <p>
            {projection.checkpoints.length
              ? 'No recorded-plan gap at the evaluated checkpoints.'
              : 'Enforcement has no eligible checkpoint inside this horizon.'}
          </p>
        )}
        {current.state === 'initializing' && (
          <p className="muted">
            You are still gathering the rolling window. Upcoming risks are planning advice, not a
            declaration that you are out of policy now.
          </p>
        )}
        <div className="button-row">
          <button
            className="primary"
            disabled={blocked || searching}
            onClick={() => void findPlan()}
          >
            {searching ? 'Finding a feasible plan...' : 'Preview suggested office days'}
          </button>
          <Link to="/calendar">Plan manually</Link>
        </div>
        {searchError && (
          <p className="error" role="alert">
            {searchError}
          </p>
        )}
      </section>
      {pastPlans.length > 0 && (
        <section className="card reminder">
          <h2>{pastPlans.length} past plans need confirmation</h2>
          <p>
            Plans are never silently promoted to actual. Review what really happened in Calendar
            using the day details action.
          </p>
          <div className="button-row">
            {pastPlans.slice(0, 5).map((entry) => (
              <span className="pill" key={entry.date}>
                {formatDate(entry.date)} · {entry.type}
              </span>
            ))}
            <Link to="/calendar">Review attendance</Link>
          </div>
        </section>
      )}
      <section className="card">
        <div className="section-heading">
          <h2>Week-by-week outlook</h2>
          <span className="muted">No guarantees beyond the horizon</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Week of</th>
                <th>Strategy</th>
                <th>Office plan</th>
                <th>Unknown dates</th>
                <th>Checkpoint: plan / capacity</th>
              </tr>
            </thead>
            <tbody>
              {projection.checkpoints.map((point) => (
                <tr key={point.end}>
                  <th scope="row">{formatDate(point.weekStart)}</th>
                  <td>
                    {preview?.revision === snapshot.revision && preview.referenceDate === today
                      ? preview.strategies[point.weekStart]
                      : strategyLabel(domainSnapshot, point.weekStart, [])}
                  </td>
                  <td>{point.committedDates.length}</td>
                  <td>{point.availableDates.length}</td>
                  <td>
                    {point.formal ? '' : 'Provisional: '}
                    {point.committed.score?.met ? 'Meets' : 'Gap'} /{' '}
                    {point.capacity.score?.met ? 'Can meet' : 'Conflict'}
                    {point.expiringWeeks.length > 0 && (
                      <span className="small block">
                        Qualifying week expires: {point.expiringWeeks.map(formatShort).join(', ')}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card policy-summary">
        <h2>Your policy, in plain language</h2>
        <p>{formulas[policy.kind].explain(policy)}</p>
        <p className="muted">
          Weeks start {weekdayName(policy.weekStart)} · {policy.timeZone} · Enforced from{' '}
          {formatDate(policy.startDate)}. Weekends earn no credit. Leave exemptions are not modeled.
          Only completed full weeks determine recorded compliance.
        </p>
        <Link to="/settings">Review policy & assumptions</Link>
      </section>
      <p role="status">{message}</p>
      {preview && (
        <Dialog title="Suggested plan preview" onClose={() => setPreview(null)}>
          <p>{preview.suggestion.explanation}</p>
          {preview.suggestion.dates.length > 0 && (
            <>
              <p>
                These are suggested, interchangeable dates unless the policy requires that weekday.
                Applying creates planned office entries in one undoable transaction, never actual
                attendance.
              </p>
              <div className="suggestion-list">
                {preview.suggestion.dates.map((date) => (
                  <span className="pill" key={date}>
                    {formatDate(date)}
                    {policy.kind === 'weekdays' ? ' · Required weekday' : ' · Suggested'}
                  </span>
                ))}
              </div>
              <p>
                <strong>Verified:</strong> The proposed plan meets all checkpoints through{' '}
                {formatDate(preview.horizonEnd)}, including provisional targets.
              </p>
            </>
          )}
          {preview.suggestion.alternatives.length > 0 && (
            <div className="notice">
              <h3>Separate alternative: review remote plans</h3>
              <p>
                These unprotected remote dates may be reviewed manually in Calendar. No conversion
                or success is assumed; recalculate after each change.
              </p>
              <p>{preview.suggestion.alternatives.map(formatShort).join(', ')}</p>
              <Link to="/calendar" onClick={() => setPreview(null)}>
                Review alternatives in Calendar
              </Link>
            </div>
          )}
          {(preview.revision !== snapshot.revision || preview.referenceDate !== today) && (
            <p role="alert" className="error">
              Data or the policy-local date changed since this preview. Close and generate a new
              plan before applying.
            </p>
          )}
          <div className="button-row">
            {preview.suggestion.state === 'ready' && (
              <button
                className="primary"
                disabled={
                  blocked ||
                  preview.revision !== snapshot.revision ||
                  preview.referenceDate !== today
                }
                onClick={async () => {
                  if (await perform(preview.action)) {
                    setPreview(null);
                    setMessage('Suggested plan saved. You can undo it from Calendar.');
                  }
                }}
              >
                Apply {preview.suggestion.dates.length} planned office days
              </button>
            )}
            <button onClick={() => setPreview(null)}>Close preview</button>
          </div>
        </Dialog>
      )}
    </>
  );
}

const formatShort = (date: string) => formatDate(date);
