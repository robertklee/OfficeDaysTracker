import { type DayType } from '../domain/schema';
import { Icon } from './Icon';

export type DayTool = DayType | 'erase';
export const dayLabels: Record<DayType, string> = {
  office: 'Office',
  remote: 'Remote',
  vacation: 'Vacation',
  sick: 'Sick',
  holiday: 'Holiday',
};

export function AttendanceTools({
  value,
  onChange,
}: {
  value: DayTool;
  onChange: (value: DayTool) => void;
}) {
  return (
    <div className="attendance-tools" role="group" aria-label="Attendance type">
      {(['office', 'remote'] as const).map((type) => (
        <button
          key={type}
          className={`tool ${type} ${value === type ? 'selected' : ''}`}
          aria-pressed={value === type}
          onClick={() => onChange(type)}
        >
          <Icon name={type} />
          {dayLabels[type]}
        </button>
      ))}
      <span className="tool-select">
        <Icon name="holiday" />
        <select
          aria-label="Time off"
          className={['vacation', 'sick', 'holiday'].includes(value) ? 'selected' : ''}
          value={['vacation', 'sick', 'holiday'].includes(value) ? value : ''}
          onChange={(event) => onChange(event.target.value as DayType)}
        >
          <option value="" disabled>
            Time off
          </option>
          <option value="vacation">Vacation</option>
          <option value="sick">Sick</option>
          <option value="holiday">Holiday</option>
        </select>
      </span>
      <button
        className={`tool ${value === 'erase' ? 'selected' : ''}`}
        aria-pressed={value === 'erase'}
        onClick={() => onChange('erase')}
      >
        <Icon name="clear" />
        Clear
      </button>
    </div>
  );
}
