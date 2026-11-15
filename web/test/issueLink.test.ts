import assert from 'node:assert/strict'
import { test } from 'node:test'
import { STRINGS, fmt } from '../src/i18n.ts'
import { issueHref, pageRef } from '../src/issueLink.ts'

test('issue link carries only title and body, URL-encoded', () => {
  const page = pageRef({ pathname: '/plume-witness/', search: '?night=a&b=c d', hash: '#detect' })
  assert.equal(page, '/plume-witness/?night=a&b=c d#detect')
  for (const l of ['en', 'es'] as const) {
    const href = issueHref(fmt(STRINGS[l]['foot.wrongTitle'], { page }), fmt(STRINGS[l]['foot.wrongBody'], { page }))
    assert.ok(href.startsWith('https://github.com/kgorle1111/plume-witness/issues/new?'))
    const u = new URL(href)
    assert.deepEqual([...u.searchParams.keys()], ['title', 'body'])
    // The page's own & and # must not leak out as extra params or a fragment.
    assert.equal(u.hash, '')
    assert.ok(u.searchParams.get('title')!.endsWith(page))
    const body = u.searchParams.get('body')!
    assert.ok(body.includes(page) && body.includes('\n'))
    assert.ok(!href.includes(' ') && !href.includes('\n'))
  }
})
