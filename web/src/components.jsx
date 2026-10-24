export function PageHeading({ eyebrow, title, description, action }) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  )
}

export function Metric({ icon, tone, label, value, helper }) {
  return (
    <section className="metric-card">
      <div className={`metric-icon ${tone}`}>{icon}</div>
      <div className="metric-label">{label}</div>
      <strong className="metric-value">{value ?? '—'}</strong>
      <small>{helper}</small>
    </section>
  )
}
