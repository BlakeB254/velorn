function slugify(value, fallback = 'item') {
  const slug = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return slug || fallback
}

function assetHay(asset) {
  return `${asset?.name || ''} ${asset?.path || ''} ${asset?.folderId || ''}`.toLowerCase()
}

function findAssetId(assets, testers) {
  const list = Array.isArray(assets) ? assets.filter((asset) => asset?.type === 'image') : []
  for (const test of testers) {
    const hit = list.find((asset) => test(assetHay(asset)))
    if (hit) return hit.id
  }
  return ''
}

function guessVoice(name = '', notes = '') {
  const hay = `${name} ${notes}`.toLowerCase()
  if (/\b(fem|sister|woman|girl|mara|laura)\b/.test(hay) && !/\bstud\b/.test(hay)) return 'Laura (female, american)'
  if (/\b(guy|antagonist|james|roger)\b/.test(hay)) return 'Eric (male, american)'
  return 'Roger (male, american)'
}

async function readText(path) {
  const api = typeof window !== 'undefined' ? window.electronAPI : null
  if (!api?.readFile || !path) return ''
  try {
    const result = await api.readFile(path, { encoding: 'utf8' })
    return result?.success ? String(result.data || '') : ''
  } catch (_) {
    return ''
  }
}

async function readJson(path) {
  const text = await readText(path)
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch (_) {
    return null
  }
}

export async function importShortFilmFromProject(project, assets = []) {
  const migration = project?.cdxMigration || {}
  const roots = Array.isArray(migration.sourceRoots) ? migration.sourceRoots.filter(Boolean) : []
  const title = migration.title || project?.name || 'Untitled'
  let bible = null
  let slotsDoc = null
  let script = ''
  for (const root of roots) {
    if (!bible) bible = await readJson(`${root}/.studio/bible.json`)
    if (!slotsDoc) slotsDoc = await readJson(`${root}/ep001/storyboard/slots.json`)
    if (!script) {
      script = (await readText(`${root}/ep001/scripts/001-accept-the-rejection.md`))
        || (await readText(`${root}/ep001/scripts/001-accept-the-rejection.gen-context.md`))
    }
  }

  const bibleChars = Array.isArray(bible?.cast?.characters) ? bible.cast.characters : []
  const characters = (bibleChars.length ? bibleChars : [
    { id: 'trip-brother', name: 'Brother', prompt_fragment: 'locs, AF pendant, black tee' },
    { id: 'trip-fem-sister', name: 'Feminine Sister', prompt_fragment: 'pink patterned set, long curly hair' },
    { id: 'trip-stud-sister', name: 'Stud Sister', prompt_fragment: 'White Sox cap, locs, TRUST NO ONE tee' },
    { id: 'trip-random-guy', name: 'Random Guy', prompt_fragment: 'clean-shaven, DAMAGE pendant, black tee' },
  ]).map((entry, index) => {
    const slug = slugify(entry.id || entry.name, `character_${index + 1}`)
    const notes = String(entry.prompt_fragment || entry.visualNotes || '')
    return {
      id: `character-${slug}`,
      slug,
      name: entry.name || slug,
      role: /guy|antagonist/i.test(entry.name || '') ? 'Antagonist' : (index === 0 ? 'Lead' : 'Cast'),
      visualNotes: notes,
      referenceAssetId: findAssetId(assets, [
        (hay) => hay.includes(slug.replace(/trip_/, 'ctt-').replace(/_/g, '-')) && hay.includes('ref-front') && !hay.includes('.pre-fix'),
        (hay) => hay.includes(slug.split('_').pop()) && hay.includes('ref-front') && !hay.includes('.bak'),
        (hay) => hay.includes(slug.split('_').pop()) && hay.includes('sheet') && !hay.includes('.bak'),
      ]),
      voicePreset: guessVoice(entry.name, notes),
      voiceNotes: notes,
    }
  })

  const locations = [
    {
      id: 'location-navy-pier-stand',
      slug: 'navy_pier_cotton_candy',
      name: 'Navy Pier cotton-candy stand',
      description: 'Pink/white striped stand screen-right, Centennial wheel screen-left, golden daylight, boardwalk crowd.',
      heroAssetId: findAssetId(assets, [
        (hay) => hay.includes('plate') && hay.includes('stand') && !hay.includes('depth'),
        (hay) => hay.includes('cotton') && hay.includes('stand'),
      ]),
      wideAssetId: findAssetId(assets, [(hay) => hay.includes('plate-02') || hay.includes('fight-zone')]),
      reverseAssetId: '',
      detailAssetId: findAssetId(assets, [(hay) => hay.includes('dusk') || hay.includes('endcard')]),
    },
  ]

  const cards = Array.isArray(project?.storyboardBoard?.cards) ? [...project.storyboardBoard.cards] : []
  cards.sort((a, b) => (a.order || 0) - (b.order || 0))
  const slots = Array.isArray(slotsDoc?.slots) ? slotsDoc.slots : []

  const shotPlan = (cards.length ? cards : slots).map((item, index) => {
    const title = item.title || item.slot_id || `Shot ${index + 1}`
    const action = item.action || item.description || item.prompt || ''
    const dialogue = item.dialogue || ''
    const speaker = characters.find((character) => (
      new RegExp(character.name.split(' ')[0], 'i').test(`${title} ${action} ${dialogue}`)
    ))
    return {
      id: item.id || item.slot_id || `shot-${String(index + 1).padStart(3, '0')}`,
      scene: 'Ep 001',
      title,
      type: /ots|cu|close/i.test(`${title} ${action}`) ? 'close-up' : (/broll|est|wide/i.test(`${title} ${action}`) ? 'wide' : 'medium'),
      locationSlug: locations[0].slug,
      characterSlug: speaker?.slug || '',
      dialogueId: '',
      keyframe: action || title,
      motion: action || title,
      keyframeAssetId: item.imageAssetId || '',
      duration: Number(item.duration || item.dur_s || 3) || 3,
    }
  })

  const screenplay = script.trim() || [
    `INT. ${locations[0].name.toUpperCase()} - DAY`,
    '',
    ...cards.map((card) => {
      const lines = [`${card.title || `SHOT ${card.order}`}`]
      if (card.action) lines.push(card.action)
      if (card.dialogue) lines.push('', card.dialogue)
      return lines.join('\n')
    }),
  ].join('\n\n')

  return {
    draft: {
      step: 'story',
      title,
      premise: bible?.concept?.logline || bible?.concept?.premise || `${title} — ${migration.runtime || 'short'} ${migration.type || 'show'}.`,
      creativeDirection: 'Photoreal Chicago urban drama, vertical 9:16, Hex & Halo energy, locked cast wardrobe, Navy Pier daylight.',
      runtimeSeconds: 30,
      aspectRatio: 'vertical_9x16',
      resolutionPreset: '1080p',
      videoFps: 24,
      screenplay,
      voiceWorkflow: 'text_to_speech',
      keyframeWorkflow: 'image-edit',
    },
    characters,
    locations,
    shotPlan,
    source: {
      slug: migration.slug || '',
      storyboardCards: cards.length,
      slots: slots.length,
      loadedBible: Boolean(bible),
      loadedScript: Boolean(script.trim()),
    },
  }
}
