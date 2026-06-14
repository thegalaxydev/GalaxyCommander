export function SvgIcon({
  name,
  size = 14,
  className = '',
}: {
  name: string
  size?: number
  className?: string
}) {
  const url = `url(/mana-svg/${name}.svg)`
  return (
    <span
      className={`svg-icon ${className}`}
      style={{
        width: size,
        height: size,
        WebkitMaskImage: url,
        maskImage: url,
      }}
    />
  )
}
