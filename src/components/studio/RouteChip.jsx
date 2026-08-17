import { routingSummary } from '../../services/shotRouting'

export default function RouteChip({ route }) {
  if (!route?.workflowId) return null
  const draft = route.draftWorkflowId && route.draftWorkflowId !== route.workflowId
    ? ` · draft ${route.draftWorkflowId}`
    : ''
  return (
    <span
      title={[routingSummary(route), route.notes, (route.reasons || []).join('; ')].filter(Boolean).join('\n')}
      className="px-1.5 py-0.5 rounded border border-sky-500/40 text-sky-200"
    >
      {route.class.replace(/_/g, ' ')} → {route.workflowId}{draft}
    </span>
  )
}
