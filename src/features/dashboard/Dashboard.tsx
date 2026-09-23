import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../../app/store';
import { type PlanningResponse } from '../../app/planning.worker';
import { AttendanceTools, dayLabels, type DayTool } from '../../components/AttendanceTools';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { editAction, type EditAction } from '../../data/repository';
import {
  addDays,
  dateRange,
  formatDate,
  isWeekend,
  startOfWeek,
  weekday,
} from '../../domain/dates';
import { evaluate, formulas, weekdayName } from '../../domain/policies';
import { forecast } from '../../domain/projection';

const stateLabel = {
  'not-started': 'Not started',
  gathering: 'No completed weeks yet',
  initializing: 'Building your history',
  compliant: 'On track',
  shortfall: 'Below target',
  invalid: 'Unable to calculate',
};

export function Dashboard() {
  const store = useStore();
  const { snapshot, today, perform, saving, pending, error } = store;
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [tool, setTool] = useState<DayTool>('office');
  const [confirmation, setConfirmation] = useState<EditAction | null>(null);
  const [message, setMessage] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [planning, setPlanning] = useState<{
    source: typeof snapshot;
    today: string;
    response: PlanningResponse;
  } | null>(null);
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

  useEffect(() => {
    if (!policy || error) return;
    let active = true;
    let worker: Worker | undefined;
    const finish = (response: PlanningResponse) => {
      if (active) setPlanning({ source: snapshot, today, response });
      worker?.terminate();
    };
    try {
      worker = new Worker(new URL('../../app/planning.worker.ts', import.meta.url), {
        type: 'module',
      });
      worker.onmessage = (event: MessageEvent<PlanningResponse>) => finish(event.data);
      worker.onerror = (event) => {
        event.preventDefault();
        finish({ error: 'Could not calculate weekly targets. Try again.' });
      };
      worker.postMessage(domainSnapshot);
    } catch {
      finish({ error: 'Could not calculate weekly targets. Try again.' });
    }
    const closePage = (event: PageTransitionEvent) => {
      if (!event.persisted) {
        active = false;
        worker?.terminate();
      }
    };
    window.addEventListener('pagehide', closePage);
    return () => {
      active = false;
      worker?.terminate();
      window.removeEventListener('pagehide', closePage);
    };
  }, [domainSnapshot, snapshot, today, policy, error, attempt]);

  if (!snapshot || !policy) return null;
  const currentStart = startOfWeek(today, policy.weekStart);
  const displayedStart = startOfWeek(selectedDate ?? today, policy.weekStart);
  const isCurrentWeek = displayedStart === currentStart;
  const isPastWeek = displayedStart < currentStart;
  const withinForecast = displayedStart >= currentStart && displayedStart <= projection.end;
  const weekDates = dateRange(displayedStart, addDays(displayedStart, 6));
  const entries = new Map(snapshot.dataset.records.map((entry) => [entry.date, entry]));
  const weekEntries = snapshot.dataset.records.filter((entry) => weekDates.includes(entry.date));
  const logged = weekEntries.filter(
    (entry) => entry.type === 'office' && entry.status === 'actual' && entry.date <= today,
  ).length;
  const planned = weekEntries.filter(
    (entry) => entry.type === 'office' && entry.status === 'planned' && entry.date >= today,
  ).length;
  const pastPlans = snapshot.dataset.records.filter(
    (entry) => entry.status === 'planned' && entry.date < today,
  );
  const response =
    planning?.source === snapshot && planning.today === today ? planning.response : null;
  const recommendation = response?.result?.weeks.find((week) => week.weekStart === displayedStart);
  const blocked = saving || !!pending || !!error;
  const eligible = displayedStart >= current.firstEligible;
  const conflict = response?.result?.state === 'conflict';
  const unavailable =
    response?.error ||
    (response?.result && ['invalid', 'limited'].includes(response.result.state)
      ? 'Could not calculate weekly targets. Review your policy or try again.'
      : null);

  async function save(action: EditAction) {
    if (await perform(action)) setMessage('Day saved.');
  }
  function showWeek(date: string | null) {
    setSelectedDate(date === currentStart ? null : date);
    setMessage('');
  }
  function enterDay(date: string) {
    if (blocked) return;
    setMessage('');
    const previous = entries.get(date);
    const action = editAction(snapshot!, [
      {
        date,
        value:
          tool === 'erase'
            ? null
            : {
                date,
                type: tool,
                status: date > today ? 'planned' : 'actual',
                priority: previous?.priority ?? 'normal',
                notes: previous?.notes ?? '',
              },
      },
    ]);
    if (previous?.priority === 'must') setConfirmation(action);
    else void save(action);
  }

  return (
    <>
      <div className="page-heading week-heading">
        <div aria-live="polite">
          <p className="eyebrow">Week of {formatDate(displayedStart)}</p>
          <h1>{isCurrentWeek ? 'This week' : isPastWeek ? 'Past week' : 'Upcoming week'}</h1>
        </div>
        <div className="week-header-actions">
          <div className="week-navigation" role="group" aria-label="Week navigation">
            <button
              aria-label="Previous week"
              onClick={() => showWeek(addDays(displayedStart, -7))}
            >
              <Icon name="left" />
            </button>
            <button disabled={isCurrentWeek} onClick={() => showWeek(null)}>
              This week
            </button>
            <button aria-label="Next week" onClick={() => showWeek(addDays(displayedStart, 7))}>
              <Icon name="right" />
            </button>
          </div>
          <Link className="button quiet" to="/calendar">
            View calendar <Icon name="arrow" />
          </Link>
        </div>
      </div>

      <section
        className="card week-card"
        aria-label={`Attendance for week of ${formatDate(displayedStart)}`}
      >
        <div className="week-summary">
          <div
            className="recommendation"
            aria-live="polite"
            aria-busy={eligible && withinForecast && !response && !error}
          >
            <p className="eyebrow">{isPastWeek ? 'Week in review' : 'Weekly recommendation'}</p>
            {error ? (
              <>
                <h2>Target unavailable</h2>
                <p>Resolve the save error above to continue.</p>
              </>
            ) : isPastWeek ? (
              <>
                <h2 className="recommendation-value">
                  <strong>{logged}</strong> office {logged === 1 ? 'day' : 'days'}
                </h2>
                <p>Select a day to correct it.</p>
              </>
            ) : !eligible ? (
              <>
                <h2>No target yet</h2>
                <p>Your first full week starts {formatDate(current.firstEligible)}.</p>
              </>
            ) : !withinForecast ? (
              <>
                <h2>No target available</h2>
                <p>
                  Recommendations run through {formatDate(projection.end)}. You can still plan days.
                </p>
              </>
            ) : unavailable ? (
              <>
                <h2>Target unavailable</h2>
                <p role="alert">{unavailable}</p>
                <button
                  onClick={() => {
                    setPlanning(null);
                    setAttempt((value) => value + 1);
                  }}
                >
                  Retry target
                </button>
              </>
            ) : conflict ? (
              <>
                <h2>Review your plan</h2>
                <p>
                  Past attendance or saved plans leave a shortfall.{' '}
                  <Link to="/calendar">Review days</Link>
                </p>
              </>
            ) : recommendation ? (
              <>
                <h2 className="recommendation-value">
                  <strong>{recommendation.officeDays}</strong> office{' '}
                  {recommendation.officeDays === 1 ? 'day' : 'days'}
                </h2>
                <p>
                  {recommendation.additionalDays
                    ? `${recommendation.additionalDays} more to plan`
                    : recommendation.officeDays
                      ? 'You have enough office days logged or planned.'
                      : 'No office days needed this week.'}
                </p>
              </>
            ) : (
              <>
                <h2>Calculating target...</h2>
                <p>You can log days now.</p>
              </>
            )}
          </div>
          <div
            className="week-totals"
            aria-label={`Office days for week of ${formatDate(displayedStart)}`}
          >
            <div className="total-logged">
              <strong data-testid="office-logged">{logged}</strong>
              <span>Office logged</span>
            </div>
            <div className="total-planned">
              <strong data-testid="office-planned">{planned}</strong>
              <span>Office planned</span>
            </div>
          </div>
        </div>
        {policy.kind === 'weekdays' && (
          <p className="week-policy-note">
            Your policy requires {policy.requiredDays.map(weekdayName).join(', ')}. Other days do
            not substitute.
          </p>
        )}
        {recommendation &&
          policy.kind === 'rolling' &&
          policy.mode === 'average' &&
          recommendation.officeDays > policy.n && (
            <p className="week-policy-note">
              Extra days this week support your rolling average. Weekend attendance may be needed.
            </p>
          )}
        <div className="week-toolbar">
          <div>
            <h2>Log your days</h2>
            <p className="muted" id="week-help">
              Choose a type, then select a day. Future days are plans.
            </p>
          </div>
          <button
            className="quiet"
            disabled={!store.undoAvailable || blocked}
            onClick={async () => {
              setMessage('');
              await store.undo();
            }}
          >
            <Icon name="undo" /> Undo
          </button>
        </div>
        <AttendanceTools value={tool} onChange={setTool} />
        <div className="week-grid" aria-describedby="week-help">
          {weekDates.map((date) => {
            const entry = entries.get(date);
            const status =
              entry?.status === 'planned'
                ? date < today
                  ? 'Needs confirmation'
                  : 'Planned'
                : entry
                  ? date > today
                    ? 'Needs review'
                    : 'Logged'
                  : date <= today
                    ? 'Not logged'
                    : 'Not set';
            return (
              <button
                key={date}
                data-date={date}
                disabled={blocked}
                aria-current={date === today ? 'date' : undefined}
                aria-label={`${formatDate(date, true)}, ${entry ? dayLabels[entry.type] : 'Unentered'}, ${status}${entry?.priority === 'must' ? ', protected' : ''}${date === today ? ', today' : ''}`}
                className={`week-day ${entry?.type ?? ''} ${entry?.status ?? ''} ${isWeekend(date) ? 'weekend' : ''}`}
                onClick={() => enterDay(date)}
              >
                <span className="week-day-heading">
                  <span>{weekdayName(weekday(date)).slice(0, 3)}</span>
                  {date === today && <span className="today-label">Today</span>}
                </span>
                <span className="week-day-number">{Number(date.slice(-2))}</span>
                <span className="week-day-type">
                  <Icon name={entry?.type ?? 'plus'} />
                  {entry ? dayLabels[entry.type] : 'Mark day'}
                </span>
                <span className="week-day-status">
                  {status}
                  {entry?.priority === 'must' && ' · Protected'}
                </span>
              </button>
            );
          })}
        </div>
        <div className="week-footnote">
          <span role="status">
            <Icon name="check" size={14} />
            {message || 'Changes save automatically.'}
          </span>
          <Link to="/calendar">
            Notes & day details <Icon name="arrow" size={14} />
          </Link>
        </div>
      </section>

      {pastPlans.length > 0 && (
        <section className="notice reminder reminder-row">
          <div>
            <h2>
              {pastPlans.length} {pastPlans.length === 1 ? 'past plan needs' : 'past plans need'}{' '}
              confirmation
            </h2>
            <p>Only logged days count toward your attendance.</p>
          </div>
          <Link to="/calendar">Review past days</Link>
        </section>
      )}
      {!error && (
        <div className="week-secondary">
          <section className={`card insight-card status-${current.state}`}>
            <p className="eyebrow">
              <Icon name="week" size={16} />
              Completed weeks
            </p>
            <h2>{stateLabel[current.state]}</h2>
            <p className="muted">{current.explanation}</p>
            {current.score && (
              <p className="history-score">
                <strong>
                  {current.score.achieved} / {current.score.target}
                </strong>{' '}
                {current.score.unit}
              </p>
            )}
            {current.windowStart && (
              <p className="small muted">
                {formatDate(current.windowStart)} - {formatDate(current.windowEnd!)}
              </p>
            )}
          </section>
          <section className="card insight-card policy-summary">
            <p className="eyebrow">
              <Icon name="settings" size={16} />
              Your policy
            </p>
            <h2>{formulas[policy.kind].label}</h2>
            <p>{formulas[policy.kind].explain(policy)}</p>
            <Link to="/settings">Edit policy</Link>
          </section>
        </div>
      )}
      {!error && (
        <details className="card outlook">
          <summary>
            Upcoming weeks <span>Weekly targets</span>
          </summary>
          <p className="muted">
            Recommended totals include logged and planned office days. Choose your own dates within
            your policy.
          </p>
          {conflict ? (
            <p className="notice">
              Check past plans awaiting confirmation, time off, and remote days in Calendar. Future
              days cannot fix a past shortfall.
            </p>
          ) : unavailable ? (
            <p role="alert">{unavailable}</p>
          ) : !response ? (
            <p>Calculating targets...</p>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Week of</th>
                    <th>Office days</th>
                    <th>More to plan</th>
                  </tr>
                </thead>
                <tbody>
                  {response.result?.weeks.map((week) => (
                    <tr key={week.weekStart}>
                      <th scope="row">
                        {formatDate(week.weekStart)}
                        {week.weekStart === currentStart && (
                          <span className="small block">This week</span>
                        )}
                      </th>
                      <td>{week.officeDays}</td>
                      <td>{week.additionalDays}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!response.result?.weeks.length && (
                <p>No complete policy weeks through {formatDate(projection.end)}.</p>
              )}
            </div>
          )}
          <p className="small muted">
            Through {formatDate(projection.end)}. Targets may change as you log days. Weekends
            count; leave does not lower your target.
          </p>
        </details>
      )}
      {confirmation && (
        <Dialog title="Change protected day?" onClose={() => setConfirmation(null)}>
          <p>This day is protected. Change it anyway?</p>
          <div className="button-row">
            <button
              className="primary"
              disabled={blocked}
              onClick={() => {
                const action = confirmation;
                setConfirmation(null);
                void save(action);
              }}
            >
              Change day
            </button>
            <button onClick={() => setConfirmation(null)}>Cancel</button>
          </div>
        </Dialog>
      )}
    </>
  );
}
