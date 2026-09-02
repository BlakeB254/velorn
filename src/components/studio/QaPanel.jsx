import { useMemo, useState } from 'react'
import { auditShot } from '../../services/studioAudit'
import { rubricFor } from '../../services/evaluationRubrics'
import { recordVerdict } from '../../services/studioStore'

const RESULT_TONE = {
  pass: 'border-sf-success/50 bg-sf-success/10 text-sf-success',
  fail: 'border-sf-error/60 bg-sf-error/10 text-sf-error',
  unverified: 'border-sf-dark-500 text-sf-text-muted',
}

const VERDICT_TONE = {
  NEEDS_REGEN: 'border-sf-error/60 bg-sf-error/10 text-sf-error',
  READY_TO_GENERATE: 'border-sf-success/50 bg-sf-success/10 text-sf-success',
  DIALOGUE_BLOCKED: 'border-sf-warning/50 bg-sf-warning/10 text-sf-warning',
  NEEDS_FLF: 'border-sf-dark-500 text-sf-text-muted',
  DONE: 'border-sf-success/50 bg-sf-success/10 text-sf-success',
}

function ResultButtons({ value, onChange }) {
  return (
    <div className="flex gap-1">
      {['pass', 'fail', 'unverified'].map((result) => (
        <button
          key={result}
          type="button"
          onClick={() => onChange(result)}
          className={`px-2 py-0.5 rounded border text-xs font-medium uppercase tracking-wider ${
            value === result ? RESULT_TONE[result] : 'border-sf-dark-700 text-sf-text-muted'
          }`}
        >
          {result}
        </button>
      ))}
    </div>
  )
}

export default function QaPanel({
  shot,
  card,
  slot,
  studio,
  onRecord,
  compact = false,
}) {
  const row = useMemo(
    () => (shot || card || slot ? auditShot({ card, slot, studio }) : null),
    [shot, card, slot, studio],
  )
  const [video, setVideo] = useState(row?.qa?.video || 'unverified')
  const [audio, setAudio] = useState(row?.qa?.audio || 'unverified')
  const [reason, setReason] = useState(row?.qa?.reason || '')
  const [error, setError] = useState('')
  const [openRubric, setOpenRubric] = useState(false)
  const videoRubric = rubricFor('video')

  if (!row?.shot) return null

  const save = () => {
    setError('')
    try {
      const next = recordVerdict(studio, row.shot, { video, audio, reason, by: 'human' })
      onRecord?.(next, row.shot)
    } catch (err) {
      setError(err.message || String(err))
    }
  }

  return (
    <div className="rounded-md border border-sf-dark-700 bg-sf-dark-950/70 p-2 space-y-1.5">
      <div className="flex flex-wrap items-center gap-1 text-[9px] uppercase tracking-wide">
        <span className={`px-1.5 py-0.5 rounded border ${VERDICT_TONE[row.verdict] || VERDICT_TONE.NEEDS_FLF}`}>
          {row.verdict}
        </span>
        <span className="text-sf-text-muted">{row.shot}</span>
        {row.qa.overall !== 'pass' && row.verdict === 'DONE' && (
          <span className="text-amber-200">unverified</span>
        )}
      </div>
      {!compact && <p className="text-[10px] text-sf-text-muted leading-snug">{row.action}</p>}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="text-[9px] text-sf-text-muted mb-0.5">Video</div>
          <ResultButtons value={video} onChange={setVideo} />
        </div>
        <div>
          <div className="text-[9px] text-sf-text-muted mb-0.5">Audio</div>
          <ResultButtons value={audio} onChange={setAudio} />
        </div>
      </div>
      <input
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder="reason (required on fail) — motion / identity / spatial / quality"
        className="w-full bg-sf-dark-900 border border-sf-dark-700 rounded px-1.5 py-1 text-[10px] text-sf-text-primary outline-none"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          className="px-2 py-0.5 rounded border border-sf-accent/50 text-[10px] text-sf-accent"
        >
          Record QA
        </button>
        <button
          type="button"
          onClick={() => setOpenRubric((value) => !value)}
          className="text-[9px] text-sf-text-muted underline"
        >
          {openRubric ? 'hide rubric' : 'video.v1 rubric'}
        </button>
      </div>
      {error && <p className="text-[10px] text-red-300">{error}</p>}
      {openRubric && (
        <div className="text-[9px] text-sf-text-muted space-y-0.5">
          <div>checks: {videoRubric.technicalChecks.join(', ')}</div>
          <div>dims: {videoRubric.dimensions.join(', ')} (≥ {videoRubric.passThreshold})</div>
          {row.qa.rubrics?.video?.disposition && (
            <div>last: {row.qa.rubrics.video.disposition}</div>
          )}
        </div>
      )}
    </div>
  )
}

export function AuditChip({ verdict, title }) {
  if (!verdict) return null
  return (
    <span
      title={title || verdict}
      className={`px-2 py-0.5 rounded border text-xs font-medium uppercase tracking-wider ${VERDICT_TONE[verdict] || VERDICT_TONE.NEEDS_FLF}`}
    >
      {verdict.replace(/_/g, ' ')}
    </span>
  )
}
