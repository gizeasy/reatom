## Migration guide

before

```js
import { declareAction, declareAtom, map, combine } from '@reatom/core-v1'

const add = declareAction()
const n1Atom = declareAtom(0, (on) => [
  on(add, (state, value) => state + value),
])
const n2Atom = declareAtom(0, (on) => [
  on(add, (state, value) => state + value),
])
const sumAtom = map(combine([n1Atom, n2Atom]), ([n1, n2]) => n1 + n2)
const rootAtom = combine({ sumAtom })
```

than

```js
import { declareAction, declareAtom, combine, v3toV1 } from '@reatom/core-v1'
import { atom } from '@reatom/core'

const add = declareAction()
const n1Atom = declareAtom(0, (on) => [
  on(add, (state, value) => state + value),
])
const n2Atom = declareAtom(0, (on) => [
  on(add, (state, value) => state + value),
])
const sumAtom = atom((ctx) => ctx.spy(n1Atom.v3atom) + ctx.spy(n2Atom.v3atom))
const rootAtom = combine({ sumAtom: v3toV1(sumAtom) })
```

than

```js
import { combine, v3toV1 } from '@reatom/core-v1'
import { action, atom } from '@reatom/core'

const add = action()
const n1Atom = atom((ctx, state = 0) => {
  ctx.spy(add).forEach(({ payload }) => (state += payload))
  return state
})
const n2Atom = atom((ctx, state = 0) => {
  ctx.spy(add).forEach(({ payload }) => (state += payload))
  return state
})
const sumAtom = atom((ctx) => ctx.spy(n1Atom) + ctx.spy(n2Atom))
const rootAtom = combine({ sumAtom: v3toV1(sumAtom) })
```

finally

```js
import { combine, v3toV1 } from '@reatom/core-v1'
import { action, atom } from '@reatom/core'

const n1Atom = atom(0)
const n2Atom = atom(0)
const add = action((ctx, value) => {
  n1Atom(ctx, (state) => state + value)
  n2Atom(ctx, (state) => state + value)
})
const sumAtom = atom((ctx) => ctx.spy(n1Atom) + ctx.spy(n2Atom))
const rootAtom = combine({ sumAtom: v3toV1(sumAtom) })
```
