import ContextFlow from './ContextFlow'

/**
 * Back-compat shim.
 *
 * The context stack used to render as a flat numbered accordion that hid every
 * `inactive` layer, so a project contributing three of ten layers displayed a
 * green "ready" badge. That view now lives in ContextFlow, which always draws
 * all ten. This wrapper keeps the old import path and prop shape working.
 *
 * `showInactive` is accepted and ignored: inactive layers are never hidden any
 * more, which was the whole point of the change.
 */
export default function ContextStackPanel({ shot = null, blocking = null, ...rest }) {
  return <ContextFlow shot={shot} blocking={blocking} {...rest} />
}
