import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useStore } from '../../app/store';
import { useDraftWarning } from '../../app/useDraftWarning';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import {
  AttendanceTools,
  dayLabels as labels,
  type DayTool,
} from '../../components/AttendanceTools';
import { editAction, toInput, type EditAction, type StoredSnapshot } from '../../data/repository';
import {
  addDays,
  dateRange,
  formatDate,
  isCivilDate,
  isWeekend,
  monthGrid,
  monthLabel,
  shiftMonth,
  startOfWeek,
  weekday,
} from '../../domain/dates';
import { weekdayName } from '../../domain/policies';
import { dayTypes, type DayType, type EntryInput } from '../../domain/schema';

type Selection = { start: string; end: string };
type Detail = { value: EntryInput; snapshot: StoredSnapshot };
const symbols: Record<DayType, string> = {
  office: 'O',
  remote: 'R',
  vacation: 'V',
  sick: 'S',
  holiday: 'H',
};

function focusRenderedDate(grid: HTMLDivElement | null, date: string) {
  const target = grid?.querySelector<HTMLButtonElement>(`[data-date="${date}"]`);
  target?.focus({ preventScroll: true });
  target?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

export function Calendar() {
  const store = useStore();
  const { snapshot, today, saving, pending, perform, error, storageLabel } = store;
  const [month, setMonth] = useState(today);
  const [focusDate, setFocusDate] = useState(today);
  const [tool, setTool] = useState<DayTool>('office');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [rangeStart, setRangeStart] = useState(today);
  const [rangeEnd, setRangeEnd] = useState(today);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [confirmation, setConfirmation] = useState<{ action: EditAction; count: number } | null>(
    null,
  );
  const [clearDialog, setClearDialog] = useState(false);
  const [includeProtected, setIncludeProtected] = useState(false);
  const [message, setMessage] = useState('');
  const drag = useRef<{
    start: string;
    end: string;
    x: number;
    y: number;
    moved: boolean;
    snapshot: StoredSnapshot;
  } | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const focusRequested = useRef(false);
  const policy = snapshot?.dataset.policy;
  const weekStart = policy?.weekStart ?? 7;
  const includeWeekends = snapshot?.dataset.preferences.includeWeekends ?? false;
  const dates = useMemo(() => monthGrid(month, weekStart), [month, weekStart]);
  const records = useMemo(
    () => new Map(snapshot?.dataset.records.map((entry) => [entry.date, entry])),
    [snapshot],
  );
  const touchedWeeks = useMemo(
    () => new Set(snapshot?.dataset.records.map((entry) => startOfWeek(entry.date, weekStart))),
    [snapshot, weekStart],
  );
  const selected = useMemo(
    () =>
      new Set(
        selection
          ? dateRange(
              selection.start,
              selection.end,
              selection.start === selection.end || includeWeekends,
            )
          : [],
      ),
    [selection, includeWeekends],
  );
  const blocked = saving || !!pending || !!error;
  useDraftWarning(!!detail || !!selection);
  useEffect(() => {
    if (focusRequested.current) {
      focusRenderedDate(grid.current, focusDate);
      focusRequested.current = false;
    }
  }, [focusDate, month, dates]);
  useEffect(() => {
    const cancel = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        drag.current = null;
        setSelection(null);
        setMessage('Selection cancelled.');
      }
    };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, []);
  if (!snapshot || !policy) return null;

  function jump(date: string) {
    setMonth(date);
    setFocusDate(date);
    focusRequested.current = true;
    focusRenderedDate(grid.current, date);
  }
  async function save(action: EditAction) {
    if (await perform(action)) {
      setMessage(
        `${action.changes.length} date${action.changes.length === 1 ? '' : 's'} saved ${storageLabel}.`,
      );
      setSelection(null);
      setDetail((current) => (current === detail ? null : current));
    }
  }
  function request(action: EditAction, base: StoredSnapshot) {
    const old = new Map(base.dataset.records.map((entry) => [entry.date, entry]));
    const count = action.changes.filter((change) => {
      const previous = old.get(change.date);
      return (
        previous?.priority === 'must' &&
        JSON.stringify(toInput(previous)) !== JSON.stringify(change.value)
      );
    }).length;
    if (count) setConfirmation({ action, count });
    else void save(action);
  }
  function paint(a: string, b: string, base = snapshot!) {
    const old = new Map(base.dataset.records.map((entry) => [entry.date, entry]));
    const values = dateRange(a, b, a === b || includeWeekends).map((date) => {
      const previous = old.get(date);
      return {
        date,
        value:
          tool === 'erase'
            ? null
            : ({
                date,
                type: tool,
                status: previous?.status ?? (date > today ? 'planned' : 'actual'),
                notes: previous?.notes ?? '',
                priority: previous?.priority ?? 'normal',
              } satisfies EntryInput),
      };
    });
    if (!values.length) {
      setMessage('No weekdays selected. Turn on weekends to include these days.');
      setSelection(null);
      return;
    }
    request(editAction(base, values), base);
  }
  function showDetail(date: string) {
    if (blocked) return;
    const entry = records.get(date);
    setDetail({
      value: entry
        ? toInput(entry)
        : {
            date,
            type: tool === 'erase' ? 'office' : tool,
            status: date > today ? 'planned' : 'actual',
            notes: '',
            priority: 'normal',
          },
      snapshot: snapshot!,
    });
  }
  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (blocked || event.button !== 0 || !event.isPrimary) return;
    const target =
      event.target instanceof Element ? event.target.closest<HTMLElement>('[data-date]') : null;
    const date = target?.dataset.date;
    if (!date) return;
    event.preventDefault();
    drag.current = {
      start: date,
      end: date,
      x: event.clientX,
      y: event.clientY,
      moved: false,
      snapshot: snapshot!,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setFocusDate(date);
    target.focus();
    setSelection({ start: date, end: date });
  }
  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current) return;
    const cell = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>('[data-date]');
    if (!cell?.dataset.date || !grid.current?.contains(cell)) return;
    current.moved ||= Math.hypot(event.clientX - current.x, event.clientY - current.y) > 6;
    current.end = cell.dataset.date;
    setSelection({ start: current.start, end: current.end });
  }
  function pointerUp(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (current) paint(current.start, current.end, current.snapshot);
  }
  function keyDown(event: KeyboardEvent<HTMLButtonElement>, date: string) {
    const offsets: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    };
    let next = date;
    if (event.key in offsets) next = addDays(date, offsets[event.key]);
    else if (event.key === 'Home') next = startOfWeek(date, weekStart);
    else if (event.key === 'End') next = addDays(startOfWeek(date, weekStart), 6);
    else if (event.key === 'PageUp' || event.key === 'PageDown')
      next = shiftMonth(date, event.key === 'PageUp' ? -1 : 1);
    else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!blocked) paint(selection?.start ?? date, selection?.end ?? date);
      return;
    } else if (event.key.toLowerCase() === 'd') {
      event.preventDefault();
      showDetail(date);
      return;
    } else return;
    event.preventDefault();
    if (event.shiftKey) setSelection({ start: selection?.start ?? date, end: next });
    else setSelection(null);
    if (!dates.includes(next)) setMonth(next);
    setFocusDate(next);
    focusRequested.current = true;
  }
  const clearable = snapshot.dataset.records.filter(
    (entry) => entry.status === 'planned' && (includeProtected || entry.priority !== 'must'),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Calendar</h1>
          <p className="muted">Edit past days or plan ahead.</p>
        </div>
        <button disabled={!store.undoAvailable || blocked} onClick={() => void store.undo()}>
          <Icon name="undo" /> Undo last change
        </button>
      </div>
      <section className="card calendar-card">
        <div className="calendar-tools">
          <AttendanceTools value={tool} onChange={setTool} />
          <label className="check">
            <input
              type="checkbox"
              checked={includeWeekends}
              disabled={blocked}
              onChange={(event) =>
                void perform({
                  type: 'settings',
                  expectedRevision: snapshot.revision,
                  policy,
                  preferences: { includeWeekends: event.target.checked },
                })
              }
            />
            Include weekends in ranges
          </label>
        </div>
        <div className="month-heading">
          <h2 aria-live="polite">{monthLabel(month)}</h2>
          <div className="button-row">
            <button aria-label="Previous month" onClick={() => jump(shiftMonth(month, -1))}>
              <Icon name="left" />
            </button>
            <button
              onClick={() => {
                setSelection(null);
                jump(today);
              }}
            >
              Today
            </button>
            <button aria-label="Next month" onClick={() => jump(shiftMonth(month, 1))}>
              <Icon name="right" />
            </button>
          </div>
        </div>
        <p className="calendar-help" id="calendar-help">
          Choose a type, then select or drag across days.
        </p>
        <div
          ref={grid}
          className="calendar-grid"
          role="grid"
          aria-label={monthLabel(month)}
          aria-describedby="calendar-help"
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          onPointerCancel={() => {
            drag.current = null;
            setSelection(null);
            setMessage('Selection cancelled.');
          }}
          onLostPointerCapture={() => {
            if (drag.current) {
              drag.current = null;
              setSelection(null);
            }
          }}
        >
          <div role="row" className="calendar-row weekdays">
            {dates.slice(0, 7).map((date) => (
              <div role="columnheader" key={date} aria-label={weekdayName(weekday(date))}>
                {weekdayName(weekday(date)).slice(0, 3)}
              </div>
            ))}
          </div>
          {Array.from({ length: 6 }, (_, row) => (
            <div role="row" className="calendar-row" key={row}>
              {dates.slice(row * 7, row * 7 + 7).map((date) => {
                const entry = records.get(date);
                const hint =
                  !entry && !isWeekend(date) && touchedWeeks.has(startOfWeek(date, weekStart));
                const accessible = `${formatDate(date, true)}, ${entry ? `${labels[entry.type]}, ${entry.status}, ${entry.priority === 'must' ? 'protected' : 'unprotected'}` : 'unentered'}${isWeekend(date) ? ', weekend' : ''}${date === today ? ', today' : ''}`;
                return (
                  <div key={date} role="gridcell" aria-selected={selected.has(date)}>
                    <button
                      data-date={date}
                      tabIndex={focusDate === date ? 0 : -1}
                      aria-label={accessible}
                      aria-current={date === today ? 'date' : undefined}
                      className={`day ${entry?.type ?? (isWeekend(date) ? 'weekend' : hint ? 'hint' : '')} ${entry?.status ?? ''} ${selected.has(date) ? 'range-preview' : ''} ${date.slice(0, 7) !== month.slice(0, 7) ? 'adjacent' : ''}`}
                      onFocus={() => setFocusDate(date)}
                      onKeyDown={(event) => keyDown(event, date)}
                      onClick={(event) => {
                        if (event.detail === 0 && !blocked) paint(date, date);
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        showDetail(date);
                      }}
                    >
                      <span className="day-number">
                        {Number(date.slice(-2))}
                        {entry?.priority === 'must' && (
                          <span aria-hidden="true" className="lock-mark">
                            {' '}
                            !
                          </span>
                        )}
                      </span>
                      {entry && (
                        <>
                          <span className="day-type">
                            <span className="type-full">{labels[entry.type]}</span>
                            <span className="type-short">{symbols[entry.type]}</span>
                          </span>
                          {entry.status === 'planned' && <span className="plan-badge">Plan</span>}
                        </>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div className="calendar-footer">
          <div className="legend">
            {dayTypes.map((type) => (
              <span key={type} className={`${type}-dot`}>
                {labels[type]}
              </span>
            ))}
            <span>Dashed = planned</span>
            <span>! = protected</span>
          </div>
          <button disabled={blocked} onClick={() => showDetail(focusDate)}>
            Details for {formatDate(focusDate)}
          </button>
        </div>
        <details className="calendar-help">
          <summary>Keyboard shortcuts & colors</summary>
          <p>
            Arrow keys move between days. Shift+arrows selects a range; Enter applies. Press D for
            details or Escape to cancel.
          </p>
          <p>
            Light days without labels are unentered. Gray days are weekends. Past plans need
            confirmation in day details.
          </p>
        </details>
      </section>
      <section className="card">
        <h2>Edit a date range</h2>
        <div className="button-row range-controls">
          <label>
            From
            <input
              type="date"
              value={rangeStart}
              onChange={(event) => setRangeStart(event.target.value)}
            />
          </label>
          <label>
            Through
            <input
              type="date"
              value={rangeEnd}
              onChange={(event) => setRangeEnd(event.target.value)}
            />
          </label>
          <button
            className="primary"
            disabled={blocked || !isCivilDate(rangeStart) || !isCivilDate(rangeEnd)}
            onClick={() => paint(rangeStart, rangeEnd)}
          >
            Apply to range
          </button>
          <button
            onClick={() => {
              setIncludeProtected(false);
              setClearDialog(true);
            }}
            disabled={blocked}
          >
            Clear planned days
          </button>
        </div>
      </section>
      <p role="status" className="save-announcement">
        {message}
      </p>
      {detail && (
        <Dialog
          title={`Day details: ${formatDate(detail.value.date)}`}
          onClose={() => setDetail(null)}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              request(
                editAction(detail.snapshot, [{ date: detail.value.date, value: detail.value }]),
                detail.snapshot,
              );
            }}
          >
            <div className="form-grid">
              <label>
                Attendance type
                <select
                  value={detail.value.type}
                  onChange={(event) =>
                    setDetail({
                      ...detail,
                      value: { ...detail.value, type: event.target.value as DayType },
                    })
                  }
                >
                  {dayTypes.map((value) => (
                    <option key={value} value={value}>
                      {labels[value]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Status
                <select
                  value={detail.value.status}
                  onChange={(event) =>
                    setDetail({
                      ...detail,
                      value: {
                        ...detail.value,
                        status: event.target.value as 'actual' | 'planned',
                      },
                    })
                  }
                >
                  <option value="actual" disabled={detail.value.date > today}>
                    Logged
                  </option>
                  <option value="planned">Planned</option>
                </select>
              </label>
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={detail.value.priority === 'must'}
                onChange={(event) =>
                  setDetail({
                    ...detail,
                    value: { ...detail.value, priority: event.target.checked ? 'must' : 'normal' },
                  })
                }
              />
              Protect this day
            </label>
            <label htmlFor="day-notes">Notes</label>
            <textarea
              id="day-notes"
              maxLength={2000}
              rows={3}
              value={detail.value.notes}
              onChange={(event) =>
                setDetail({ ...detail, value: { ...detail.value, notes: event.target.value } })
              }
            />
            <p className="muted">
              Protected days require confirmation before editing. They do not change your target.
            </p>
            <div className="button-row">
              <button className="primary" disabled={blocked}>
                Save day
              </button>
              <button
                type="button"
                disabled={blocked}
                onClick={() =>
                  request(
                    editAction(detail.snapshot, [{ date: detail.value.date, value: null }]),
                    detail.snapshot,
                  )
                }
              >
                Clear day
              </button>
            </div>
          </form>
        </Dialog>
      )}
      {confirmation && (
        <Dialog title="Change protected days?" onClose={() => setConfirmation(null)}>
          <p>
            Change {confirmation.count} protected {confirmation.count === 1 ? 'day' : 'days'}?
          </p>
          <div className="button-row">
            <button
              className="danger"
              disabled={blocked}
              onClick={() => {
                const action = confirmation.action;
                setConfirmation(null);
                void save(action);
              }}
            >
              Change protected days
            </button>
            <button onClick={() => setConfirmation(null)}>Cancel</button>
          </div>
        </Dialog>
      )}
      {clearDialog && (
        <Dialog title="Clear planned days" onClose={() => setClearDialog(false)}>
          <label className="check">
            <input
              type="checkbox"
              checked={includeProtected}
              onChange={(event) => setIncludeProtected(event.target.checked)}
            />
            Include protected days
          </label>
          <p>
            Remove {clearable.length} {clearable.length === 1 ? 'plan' : 'plans'}? Logged days stay.
            You can undo this.
          </p>
          <div className="button-row">
            <button
              className="danger"
              disabled={!clearable.length || blocked}
              onClick={() => {
                const action = editAction(
                  snapshot,
                  clearable.map((entry) => ({ date: entry.date, value: null })),
                );
                setClearDialog(false);
                void save(action);
              }}
            >
              Remove {clearable.length} {clearable.length === 1 ? 'plan' : 'plans'}
            </button>
            <button onClick={() => setClearDialog(false)}>Cancel</button>
          </div>
        </Dialog>
      )}
    </>
  );
}
