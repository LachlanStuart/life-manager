import { Icon } from './Icons';
import { VIEW_SORTS, type ViewSort } from './view-sort';

export function SortControl({ value, onChange, propertyName }: { propertyName?: string; value: ViewSort; onChange: (sort: ViewSort) => void }) {
  return <label className="lm-sort-control" data-active={value !== 'Order'} title={`Sort: ${value === 'Status' ? propertyName ?? 'Property' : value}`}>
    <Icon name="sort" />
    <select aria-label="Sort current view" value={value} onChange={event => onChange(event.target.value as ViewSort)}>
      {VIEW_SORTS.map(sort => <option key={sort} value={sort}>{sort === 'Status' ? propertyName ?? 'Property' : sort}</option>)}
    </select>
  </label>;
}
