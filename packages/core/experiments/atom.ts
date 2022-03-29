// --- UTILS

export type AllTypes =
  | undefined
  | null
  | boolean
  | number
  | string
  | Record<keyof any, any>
  | Fn
  | symbol
  | bigint

export interface Fn<Args extends any[] = any[], Return = any> {
  (...a: Args): Return
}

export interface Rec<Values = any> extends Record<string, Values> {}

export type Merge<Intersection> = Intersection extends Fn
  ? Intersection
  : Intersection extends new (...a: any[]) => any
  ? Intersection
  : Intersection extends object
  ? {
      [Key in keyof Intersection]: Intersection[Key]
    }
  : Intersection

export type Values<T> = Merge<T[keyof T]>

export type OmitValues<Collection, Target> = Merge<
  Omit<
    Collection,
    Values<{
      [K in keyof Collection]: Collection[K] extends Target ? K : never
    }>
  >
>
export type PickValues<Collection, Target> = Merge<
  Pick<
    Collection,
    Values<{
      [K in keyof Collection]: Collection[K] extends Target ? K : never
    }>
  >
>

export type Replace<T, K extends keyof T, V> = {
  [k in keyof T]: k extends K ? V : T[k]
}

export const noop: Fn = () => {}

export const identity: {
  <T>(value: T): T
} = (value) => value

const memoInitCache: any = Symbol()

export function callSafety<I extends any[], O, This = unknown>(
  this: This,
  fn: (this: This, ...a: I) => O,
  ...args: I
): O | Error {
  try {
    return fn.apply(this, args)
  } catch (error: any) {
    // TODO: error cause
    error = error instanceof Error ? error : new Error(error)
    setTimeout(() => {
      throw error
    })
    return error
  }
}

export const isObject = (thing: any): thing is Record<keyof any, any> =>
  typeof thing === 'object' && thing !== null

export const shallowEqual = (a: any, b: any) => {
  if (isObject(a) && isObject(b)) {
    const aKeys = Object.keys(a)
    const bKeys = Object.keys(b)
    return (
      aKeys.length === bKeys.length && aKeys.every((k) => Object.is(a[k], b[k]))
    )
  } else {
    return Object.is(a, b)
  }
}

// @ts-expect-error
const AsyncFunctionConstructor = (async () => {}).__proto__.constructor

type QueueNode<T> = null | [T, QueueNode<T>]
class Queue<T = any> {
  async: boolean
  handler: Fn<[T]>
  head: QueueNode<T>
  tail: QueueNode<T>

  constructor(handler: Queue<T>[`handler`], async: Queue<T>['async'] = false) {
    this.async = async
    this.handler = handler
    this.head = null
    this.tail = null
  }

  add(value: T) {
    this.tail =
      this.head === null
        ? (this.head = [value, null])
        : (this.tail![1] = [value, null])
  }

  next(): { done: true } | { done: false; value: T } {
    const next = this.head

    if (next === null) return { done: true }

    this.head = next[1]
    return { done: false, value: next[0] }
  }

  [Symbol.iterator]() {
    return this
  }
}

const walk = (queues: Array<Queue | Fn>) => {
  for (let i = 0; i < queues.length; i++) {
    const queue = queues[i]
    if (typeof queue === 'function') queue()
    else if (queue.head !== null) {
      i = 0
      // @ts-expect-error
      if (queue.async) queue.handler(queue.next().value)
      else for (const value of queue) queue.handler(value)
    }
  }
}

// --- SOURCES

/** Context */
export interface Ctx {
  actualize(meta: AtomMeta, mutator?: Fn<[AtomCache]>): AtomCache
  get<T>(atom: Atom<T>): T
  log(cb: Fn<[Patches, null | Error]>): Unsubscribe
  read<T>(atom: Atom<T>): undefined | AtomCache<T>
  run<T>(cb: Fn<[], T>): T
  schedule<T>(fn?: Fn<[], T>): Promise<T>
  subscribe<T>(atom: Atom<T>, cb: Fn<[T]>): Unsubscribe
}

export interface Patches extends Map<AtomMeta, AtomCache> {}

export interface CtxComputed extends Ctx {
  spy<T>(atom: Atom<T>): T
}

interface Atom<State = any> {
  __reatom: AtomMeta<State>
}

interface AtomMeta<State = any> {
  readonly computer: Fn<[CtxComputed, AtomCache]>
  readonly isAction: boolean
  readonly isInspectable: boolean
  readonly name: string
  readonly onCleanup: Array<Fn<[Ctx, AtomCache]>>
  readonly onInit: Array<Fn<[Ctx, AtomCache]>>
  readonly onUpdate: Array<Atom>
  // toJSON
  // fromJSON
}

// The order of properties is sorted by debugging purposes
interface AtomCache<State = any> {
  state: State
  cause: string
  /** key of a cache */
  readonly meta: AtomMeta
  parents: Array<AtomCache>
  readonly children: Set<AtomMeta>
  readonly listeners: Set<Fn>
  actual: boolean
}

interface Action<Param = void, Res = any>
  extends Atom<null | { payload: Res }> {
  (ctx: Ctx, param: Param): Res
}

export type AtomState<T> = T extends Atom<infer State> ? State : never

export interface Unsubscribe {
  (): void
}

export const isAtom = (thing: any): thing is Atom => {
  return Boolean(thing?.__reatom)
}

const isStale = (cache: AtomCache): boolean => {
  return cache.children.size + cache.listeners.size === 0
}

const assertsFunction = (thing: any, name: string): asserts thing is Fn => {
  if (typeof thing !== 'function') {
    throw new Error(`"${name}" should be a function`)
  }
}

// const throwAsyncFunction = (fn: Fn) => {
//   if (fn instanceof AsyncFunctionConstructor) {
//     throw new TypeError(
//       `Async functions restricted here, use regular functions and "schedule" instead`,
//     )
//   }
// }

const createCache = (meta: AtomMeta): AtomCache => {
  return {
    state: undefined,
    cause: 'init',
    meta,
    parents: [],
    children: new Set(),
    listeners: new Set(),
    actual: false,
  }
}

export const createContext = (): Ctx => {
  const caches = new WeakMap<AtomMeta, AtomCache>()
  const logs = new Set<Parameters<Ctx[`log`]>[0]>()
  let patches: null | Patches = null
  let error: null | Error = null

  const computersEnqueue = (cache: AtomCache) => {
    for (const childMeta of cache.children) {
      const childCache = patches!.get(childMeta) ?? caches.get(childMeta)!

      if (childCache.actual) {
        patches!.set(childMeta, { ...childCache, actual: false })

        // actualize closest atoms first, coz they could cause new updates
        if (childCache.listeners.size > 0) Q.computers.add(childMeta)

        computersEnqueue(childCache)
      }
    }
  }

  const actualizeParents = (patch: AtomCache) => {
    if (
      patch.meta.isAction ||
      (patch.parents.length > 0 &&
        patch.parents.every(
          (dep) =>
            Object.is(dep.state, actualize(dep.meta).state) ||
            !(patch.cause = dep.meta.name),
        ))
    )
      return

    patch.parents = []

    patch.meta.computer(
      Object.assign({}, ctx, {
        spy: (atom: Atom) =>
          patch.parents[patch.parents.push(actualize(atom.__reatom)) - 1].state,
        name: patch.meta.name,
      }),
      patch,
    )
  }

  const actualize: Ctx['actualize'] = (meta, mutator) => {
    const cache = patches!.get(meta) ?? caches.get(meta) ?? createCache(meta)

    if (cache.actual && mutator === undefined && !isStale(cache)) return cache

    const wasStale = isStale(cache)
    const { parents, state } = cache
    const patch = Object.assign({}, cache)

    patches!.set(meta, patch)

    patch.actual = false

    mutator?.(patch)
    actualizeParents(patch)

    if (!Object.is(state, patch.state)) {
      computersEnqueue(patch)

      for (const hook of patch.meta.onUpdate) Q.computers.add(hook.__reatom)

      for (const l of patch.listeners) {
        Q.effects.add(() => l(patch.state, patch))
      }
    }

    if (
      patch.parents !== parents &&
      (patch.parents.length !== parents.length ||
        patch.parents.some((dep, i) => dep.meta !== parents[i].meta))
    ) {
      Q.links.add(patch)
    }

    if (!wasStale && isStale(patch)) {
      Q.unlinks.add(patch)
    }

    if (patch.meta.onInit.length + patch.meta.onCleanup.length > 0) {
      Q.hooks.add([patch, wasStale])
    }

    if (!meta.isAction) Q.updates.add(patch)

    patch.actual = true

    return patch
  }

  const logsHandler = () => {
    if (patches !== null) for (const cb of logs) callSafety(cb, patches, error)
  }

  const cleanupHandler = () => {
    patches = error = null
  }

  const updatesHandler = (patch: AtomCache) => {
    caches.set(patch.meta, patch)
  }

  const linksHandler = (patch: AtomCache) => {
    const cache = caches.get(patch.meta)

    if (cache !== undefined) {
      for (const dep of cache.parents) {
        dep.children.delete(cache.meta)
        Q.unlinks.add(dep)
      }
    }

    for (const dep of patch.parents) dep.children.add(patch.meta)
  }

  const unlinksHandler = (cache: AtomCache) => {
    if (isStale(cache)) {
      if (cache.meta.onCleanup.length > 0) Q.hooks.add([cache, false])
      for (const dep of cache.parents) {
        dep.children.delete(cache.meta)
        unlinksHandler(dep)
      }
    }
  }

  const hooksHandler = ([patch, wasStale]: [AtomCache, boolean]) => {
    if (wasStale !== isStale(patch)) {
      for (const hook of wasStale ? patch.meta.onInit : patch.meta.onCleanup) {
        Q.effects.add(() => hook(ctx, patch))
      }
    }
  }

  const Q = {
    computers: new Queue(actualize),
    logs: logsHandler,
    cleanup: cleanupHandler,
    links: new Queue(linksHandler),
    unlinks: new Queue(unlinksHandler),
    hooks: new Queue(hooksHandler),
    updates: new Queue(updatesHandler),
    effects: new Queue(callSafety, true),
  }
  const queues = Object.values(Q)

  const ctx: Ctx = {
    actualize(meta, mutator) {
      return ctx.run(() => actualize(meta, mutator))
    },
    get(atom) {
      return ctx.run(() => actualize(atom.__reatom).state)
    },
    log(cb) {
      logs.add(cb)
      return () => logs.delete(cb)
    },
    read(atom) {
      return caches.get(atom.__reatom)
    },
    run(cb) {
      if (patches !== null) return cb()
      patches = new Map()

      try {
        var res = cb()
        walk(queues)
      } finally {
        patches = error = null
      }

      return res!
    },
    schedule(effect) {
      return new Promise<any>((res, rej) =>
        Q.effects.add(() => new Promise((r) => r(effect?.())).then(res, rej)),
      )
    },
    subscribe({ __reatom: meta }, cb) {
      let lastState = memoInitCache
      const fn: typeof cb = (state) =>
        Object.is(lastState, state) || cb((lastState = state))

      let cache = caches.get(meta)
      cache ?? caches.set(meta, (cache = createCache(meta)))
      const { children, listeners } = cache

      if (listeners.size + children.size > 0) listeners.add(fn)
      else {
        try {
          ctx.run(() => actualize(meta, () => listeners.add(fn)))
        } finally {
          // use `finally` instead of `catch` for to symbols economy
          if (cache === caches.get(meta)) listeners.delete(fn)
        }
      }

      let subscribed = true
      return () => {
        if (subscribed) {
          subscribed = false
          if (listeners.size + children.size > 1) listeners.delete(fn)
          else ctx.run(() => actualize(meta, () => listeners.delete(fn)))
        }
      }
    },
  }

  return ctx
}

export type atom<
  State = any,
  Actions extends null | Rec<Fn<[State, ...any[]], State>> = null,
> = Atom<State> &
  Merge<
    Actions extends null
      ? { update: Action<State | Fn<[State], State>, State> }
      : {
          [K in keyof Actions]: Actions[K] extends Fn<[State, infer Param]>
            ? Action<Param, State>
            : never
        }
  >

let atomsCount = 0
export const atom: {
  <State>(
    initState: Fn<[CtxComputed], State> | State,
    actions?: null,
    options?: Merge<Omit<Partial<AtomMeta>, 'computer'>>,
  ): atom<State, { update: Fn<[State, State | Fn<[State]>], State> }>
  <State, Actions extends Rec<Fn<[State, ...any[]], State>>>(
    initState: Fn<[CtxComputed], State> | State,
    actions: Actions,
    options?: Merge<Omit<Partial<AtomMeta>, 'computer'>>,
  ): atom<State, Actions>
} = (
  initState: Fn<[CtxComputed]> | {},
  actions?: null | Rec<Fn>,
  options: Merge<Omit<Partial<AtomMeta>, 'computer'>> = {},
): atom => {
  const computer =
    typeof initState === 'function'
      ? // @ts-ignore
        (ctx, patch) => (patch.state = initState(ctx, patch.state))
      : // @ts-ignore
        (ctx, patch) => (patch.state ??= initState)

  const {
    name,
    isAction = false,
    isInspectable = !!name,
    onCleanup = [],
    onInit = [],
    onUpdate = [],
  } = options

  const meta: AtomMeta = {
    name: name ?? `atom${++atomsCount}`,
    isAction,
    isInspectable,
    computer,
    onCleanup,
    onInit,
    onUpdate,
  }

  // @ts-ignore
  actions ??= {
    // @ts-ignore
    update: (state = initState, update: State | Fn<[State], State>) =>
      // @ts-ignore
      typeof update === 'function' ? update(state) : update,
  }

  const atom = { ...actions, __reatom: meta }

  for (const name in actions) {
    // @ts-ignore
    atom[name] = action(
      (ctx, param) =>
        ctx.actualize(meta, (patch) => {
          const prevState = patch.state
          // @ts-ignore
          patch.state = actions[name](prevState, param)
          if (!Object.is(prevState, patch.state)) patch.cause = name
        }).state,
      `${name}__${meta.name}`,
    )
  }

  // @ts-ignore
  return atom
}

export const action: {
  <Param = void, Res = void>(fn: Fn<[Ctx, Param], Res>, name?: string): Action<
    Param,
    Res
  >
} = (fn: Fn, name = `action${++atomsCount}`): Action<any, any> => {
  const action = Object.assign(
    // @ts-ignore
    (ctx, param) =>
      ctx.run(
        () =>
          // @ts-ignore
          ctx.actualize(action.__reatom, (patch) => {
            patch.state = {
              payload: fn({ ...ctx, name: action.__reatom.name }, param),
            }
            patch.cause = ctx.name ?? `external call`
          }).state.payload,
      ),
    atom(null, {}, { name, isAction: true }),
  )

  // @ts-ignore
  return action
}
