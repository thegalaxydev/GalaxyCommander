export function ManaCost({ cost }: { cost: string }) {
  const symbols = cost.match(/\{[^}]+\}/g) ?? []
  if (!symbols.length) return null
  return (
    <span className="mana-cost">
      {symbols.map((s, i) => {
        const sym = s.slice(1, -1).toLowerCase().replace('/', '')
        const cls = sym === 't' ? 'tap' : sym === 'q' ? 'untap' : sym
        return <i key={i} className={`ms ms-${cls} ms-cost ms-shadow`} />
      })}
    </span>
  )
}

export function ColorPips({ identity }: { identity: string[] }) {
  const colors = identity.length ? identity : ['C']
  return (
    <span className="mana-cost">
      {colors.map((c) => (
        <i key={c} className={`ms ms-${c.toLowerCase()} ms-cost ms-shadow`} />
      ))}
    </span>
  )
}
