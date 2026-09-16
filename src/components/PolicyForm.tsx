import { useState } from 'react';
import { dateInZone, formatDate } from '../domain/dates';
import { formulas, weekdayName, evaluate } from '../domain/policies';
import { forecast } from '../domain/projection';
import { defaultPolicy, policySchema, type Policy } from '../domain/schema';
import { useStore } from '../app/store';
import { useDraftWarning } from '../app/useDraftWarning';

export function PolicyForm({ setup = false }: { setup?: boolean }) {
  const { snapshot, today, timeZone, perform, pending, saving, error: storageError } = useStore();
  const [draft, setDraft] = useState<Policy>(
    () => snapshot?.dataset.policy ?? defaultPolicy(today, timeZone),
  );
  const [preview, setPreview] = useState<Policy | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [dirty, setDirty] = useState(false);
  useDraftWarning(dirty);
  if (!snapshot) return null;
  const patch = (values: Partial<Policy>) => {
    setDraft((current) => ({ ...current, ...values }) as Policy);
    setDirty(true);
    setPreview(null);
    setMessage('');
  };
  const switchKind = (kind: Policy['kind']) => {
    const base = {
      startDate: draft.startDate,
      timeZone: draft.timeZone,
      weekStart: draft.weekStart,
    };
    setDraft(
      kind === 'rolling'
        ? { ...base, kind, x: 8, y: 12, n: 3, mode: 'average' }
        : kind === 'weekly'
          ? { ...base, kind, n: 3, windowWeeks: 4 }
          : { ...base, kind, requiredDays: [2, 3, 4], windowWeeks: 4 },
    );
    setPreview(null);
    setDirty(true);
  };
  const previewToday = preview ? dateInZone(new Date().toISOString(), preview.timeZone) : today;
  const evaluation = preview ? evaluate(preview, snapshot.dataset.records, previewToday) : null;
  const projection = preview
    ? forecast({ policy: preview, records: snapshot.dataset.records, today: previewToday })
    : null;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = policySchema.safeParse(draft);
        if (!parsed.success) {
          setError(parsed.error.issues.map((issue) => issue.message).join(' '));
          setPreview(null);
        } else {
          setError('');
          setPreview(parsed.data);
        }
      }}
    >
      {setup && (
        <div className="notice">
          <strong>Your browser, your data.</strong> No account or attendance server. Browser
          eviction, private browsing, clearing site data, or switching browsers can lose your
          records. Keep JSON backups. The suggested best-8-of-12 average policy is only a starting
          point, not a claim about your employer.
        </div>
      )}
      <div className="form-grid">
        <label>
          Policy family
          <select
            value={draft.kind}
            onChange={(event) => switchKind(event.target.value as Policy['kind'])}
          >
            {Object.values(formulas).map((formula) => (
              <option key={formula.kind} value={formula.kind}>
                {formula.label}
              </option>
            ))}
          </select>
        </label>
        {draft.kind === 'rolling' && (
          <>
            <label>
              Rolling mode
              <select
                value={draft.mode}
                onChange={(event) =>
                  patch({ mode: event.target.value as 'qualifying' | 'average' })
                }
              >
                <option value="qualifying">Qualifying weeks</option>
                <option value="average">Average of best weeks</option>
              </select>
            </label>
            <label>
              Best weeks (X)
              <input
                type="number"
                min="1"
                max="52"
                required
                value={draft.x}
                onChange={(event) => patch({ x: event.target.valueAsNumber })}
              />
            </label>
            <label>
              Window weeks (Y)
              <input
                type="number"
                min="1"
                max="52"
                required
                value={draft.y}
                onChange={(event) => patch({ y: event.target.valueAsNumber })}
              />
            </label>
          </>
        )}
        {draft.kind !== 'weekdays' && (
          <label>
            Office days per week (N)
            <input
              type="number"
              min="1"
              max="5"
              required
              value={draft.n}
              onChange={(event) => patch({ n: event.target.valueAsNumber })}
            />
          </label>
        )}
        {draft.kind !== 'rolling' && (
          <label>
            Reporting window (weeks)
            <input
              type="number"
              min="1"
              max="52"
              required
              value={draft.windowWeeks}
              onChange={(event) => patch({ windowWeeks: event.target.valueAsNumber })}
            />
          </label>
        )}
        <label>
          Enforcement start
          <input
            type="date"
            required
            value={draft.startDate}
            onChange={(event) => patch({ startDate: event.target.value })}
          />
        </label>
        <label>
          Policy week starts
          <select
            value={draft.weekStart}
            onChange={(event) => patch({ weekStart: Number(event.target.value) as 1 | 6 | 7 })}
          >
            <option value="1">Monday</option>
            <option value="7">Sunday</option>
            <option value="6">Saturday</option>
          </select>
        </label>
        <label>
          Policy timezone
          <input
            required
            value={draft.timeZone}
            onChange={(event) => patch({ timeZone: event.target.value })}
            placeholder="America/Los_Angeles"
          />
        </label>
      </div>
      {draft.kind === 'weekdays' && (
        <fieldset>
          <legend>Required weekdays</legend>
          <div className="button-row">
            {[1, 2, 3, 4, 5].map((day) => (
              <label className="check" key={day}>
                <input
                  type="checkbox"
                  checked={draft.requiredDays.includes(day)}
                  onChange={(event) =>
                    patch({
                      requiredDays: event.target.checked
                        ? [...draft.requiredDays, day].sort()
                        : draft.requiredDays.filter((value) => value !== day),
                    })
                  }
                />
                {weekdayName(day)}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <p className="muted">
        Every recorded office day can earn credit, including weekends. Leave does not reduce
        targets. Midweek enforcement begins formal evaluation with the next full week. Current weeks
        are provisional.
      </p>
      <button className="primary" type="submit">
        Preview policy
      </button>
      {preview && (
        <section className="notice preview" aria-label="Policy preview">
          <h3>Confirm your policy</h3>
          <p>{formulas[preview.kind].explain(preview)}</p>
          <p>
            Weeks begin {weekdayName(preview.weekStart)} in {preview.timeZone}. Enforcement:{' '}
            {formatDate(preview.startDate)}. First full eligible week:{' '}
            {formatDate(evaluation!.firstEligible)}.
          </p>
          <p>
            <strong>Recalculated attendance:</strong> {evaluation?.explanation}
            <br />
            <strong>Future plan:</strong> {projection?.explanation} through{' '}
            {projection && formatDate(projection.end)}.
          </p>
          {!setup && (
            <p>
              These changes recalculate historical records under the new policy; policy history is
              not retained. Changing the week start changes grouping and due dates.
            </p>
          )}
          {preview.timeZone !== timeZone && (
            <p>
              <strong>Timezone change:</strong> Today changes from {today} ({timeZone}) to{' '}
              {previewToday} ({preview.timeZone}). Week-end deadlines now follow the new timezone;
              the next checkpoint is {projection?.checkpoints[0]?.end ?? 'outside the horizon'}.
              Existing attendance dates do not move.
            </p>
          )}
          <button
            className="primary"
            type="button"
            disabled={saving || !!pending || !!storageError}
            onClick={async () => {
              if (
                await perform({
                  type: 'settings',
                  expectedRevision: snapshot.revision,
                  policy: preview,
                  preferences: snapshot.dataset.preferences,
                })
              ) {
                setPreview(null);
                setDirty(false);
                setMessage('Policy confirmed and saved on this browser.');
              }
            }}
          >
            {setup ? 'Confirm policy & start' : 'Apply policy changes'}
          </button>
        </section>
      )}
      {message && <p role="status">{message}</p>}
    </form>
  );
}
