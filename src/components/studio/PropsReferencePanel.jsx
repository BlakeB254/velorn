import SimpleReferencePanel from './SimpleReferencePanel'

/** Prop reference cards (plan §4.3): hero shot + optional angle shots. */
export default function PropsReferencePanel() {
  return (
    <SimpleReferencePanel
      kind="prop"
      addPlaceholder="New prop name…"
      emptyHint="No prop reference cards yet. The creation wizard scaffolds them from your props list, or add one above."
      testId="prop-reference-panel"
    />
  )
}
