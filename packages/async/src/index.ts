// TODO https://hyperfetch.bettertyped.com/docs/Getting%20Started/Comparison/

import {
  action,
  Action,
  ActionParams,
  ActionPayload,
  atom,
  Atom,
  AtomMut,
  Ctx,
  CtxParams,
  Fn,
  throwReatomError,
} from '@reatom/core'
import { __thenReatomed } from '@reatom/effects'
import { addOnUpdate, onUpdate } from '@reatom/hooks'

export interface AsyncAction<Params extends any[] = any[], Resp = any>
  extends Action<Params, ControlledPromise<Resp>> {
  onFulfill: Action<[Resp], Resp>
  onReject: Action<[unknown], unknown>
  onSettle: Action<[], void>
  pendingAtom: Atom<number>
}

export interface AsyncCtx extends Ctx {
  controller: AbortController
}

export interface ControlledPromise<T> extends Promise<T> {
  controller: AbortController
}

export const isAbortError = (thing: any): thing is Error =>
  thing instanceof Error && thing.name === 'AbortError'

export const reatomAsync = <
  Params extends [AsyncCtx, ...any[]] = [AsyncCtx, ...any[]],
  Resp = any,
>(
  effect: Fn<Params, Promise<Resp>>,
  name?: string,
): AsyncAction<CtxParams<Params>, Resp> => {
  type Self = AsyncAction<CtxParams<Params>, Resp>
  // @ts-ignore
  const onEffect: Self = action((ctx, ...a) => {
    const controller = new AbortController()
    controller.signal.throwIfAborted ??= () => {
      if (controller.signal.aborted) {
        const error = new Error(controller.signal.reason)
        error.name = 'AbortError'
        throw error
      }
    }
    pendingAtom(ctx, (s) => ++s)

    const promise = Object.assign(
      // @ts-ignore
      ctx.schedule(() => effect(Object.assign(ctx, { controller }), ...a)),
      { controller },
    )

    __thenReatomed(
      ctx,
      promise,
      (v) => {
        pendingAtom(ctx, (s) => --s)
        onFulfill(ctx, v)
        onSettle(ctx)
      },
      (e) => {
        pendingAtom(ctx, (s) => --s)
        onReject(ctx, e)
        onSettle(ctx)
      },
    )

    return promise
  }, name)

  const onFulfill: Self['onFulfill'] = action(name?.concat('.onFulfill'))
  const onReject: Self['onReject'] = action(name?.concat('.onReject'))
  const onSettle: Self['onSettle'] = action(name?.concat('.onSettle'))

  const pendingAtom = atom(0, name?.concat('.pendingAtom'))

  return Object.assign(onEffect, {
    onFulfill,
    onReject,
    onSettle,
    pendingAtom,
  })
}

// TODO
// @ts-ignore
export const withDataAtom: {
  <
    T extends AsyncAction & {
      dataAtom?: AtomMut<ActionPayload<T['onFulfill']>>
    },
  >(): Fn<
    [T],
    T & { dataAtom: AtomMut<undefined | ActionPayload<T['onFulfill']>> }
  >
  <
    T extends AsyncAction & {
      dataAtom?: AtomMut<ActionPayload<T['onFulfill']>>
    },
  >(
    initState: ActionPayload<T['onFulfill']>,
  ): Fn<[T], T & { dataAtom: AtomMut<ActionPayload<T['onFulfill']>> }>
  <
    T extends AsyncAction & {
      dataAtom?: AtomMut<State | ActionPayload<T['onFulfill']>>
    },
    State,
  >(
    initState: State,
  ): Fn<[T], T & { dataAtom: AtomMut<State | ActionPayload<T['onFulfill']>> }>
} =
  (initState: any) =>
  // @ts-ignore
  (anAsync) => {
    if (!anAsync.dataAtom) {
      onUpdate(
        anAsync.onFulfill,
        // @ts-expect-error
        (anAsync.dataAtom = atom(
          initState,
          anAsync.__reatom.name?.concat('.dataAtom'),
        )),
      )
    }

    return anAsync
  }

export const withErrorAtom =
  <T extends AsyncAction & { errorAtom?: Atom<undefined | Err> }, Err = Error>(
    parseError: Fn<[unknown], Err> = (e) =>
      (e instanceof Error ? e : new Error(String(e))) as Err,
  ): Fn<[T], T & { errorAtom: Atom<undefined | Err> }> =>
  (anAsync) => {
    if (!anAsync.errorAtom) {
      const errorAtom = (anAsync.errorAtom = atom<undefined | Err>(
        undefined,
        anAsync.__reatom.name?.concat('.errorAtom'),
      ))
      addOnUpdate(anAsync.onReject, (ctx, { state }) =>
        errorAtom(ctx, parseError(state[0])),
      )
      addOnUpdate(anAsync.onFulfill, (ctx) => errorAtom(ctx, undefined))
    }

    return anAsync as T & { errorAtom: Atom<undefined | Err> }
  }

export const withAbort =
  <
    T extends AsyncAction & {
      onAbort?: Action<[Error], Error>
      abortControllerAtom?: Atom<AbortController | null>
    },
  >({
    strategy = 'last-in-win',
  }: { strategy?: 'none' | 'last-in-win' } = {}): Fn<
    [T],
    T & {
      onAbort: Action<[Error], Error>
      abortControllerAtom: Atom<AbortController | null>
    }
  > =>
  (anAsync) => {
    if (!anAsync.onAbort) {
      const abortControllerAtom = (anAsync.abortControllerAtom =
        atom<null | AbortController>(null))
      anAsync.onAbort = action(anAsync.__reatom.name?.concat('.onAbort'))
      addOnUpdate(anAsync.onReject, (ctx, patch) => {
        const error = patch.state.at(-1)?.payload
        if (isAbortError(error)) anAsync.onAbort!(ctx, error)
      })
      addOnUpdate(anAsync, (ctx, patch) => {
        const promise = patch.state.at(-1)?.payload
        if (!promise) return

        if (strategy === 'last-in-win') {
          ctx.get(abortControllerAtom)?.abort('concurrent request')
          abortControllerAtom(ctx, promise.controller)
        }
      })
      if (strategy === 'last-in-win') {
        addOnUpdate(anAsync.onSettle, (ctx) => abortControllerAtom(ctx, null))
      }
    }

    return anAsync as T & {
      onAbort: Action<[Error], Error>
      abortControllerAtom: Atom<AbortController | null>
    }
  }

export const withRetryAction =
  <
    T extends AsyncAction & {
      paramsAtom?: Atom<undefined | ActionParams<T>>
      retry?: Action<[], ActionPayload<T>>
    },
  >({
    onReject,
  }: { onReject?: Fn<[Ctx, unknown, number], void | number> } = {}): Fn<
    [T],
    T & {
      paramsAtom: Atom<undefined | ActionParams<T>>
      retry: Action<[], ActionPayload<T>>
    }
  > =>
  (anAsync) => {
    if (!anAsync.paramsAtom) {
      const paramsAtom = (anAsync.paramsAtom = atom<
        undefined | ActionParams<T>
      >(undefined, anAsync.__reatom.name?.concat('.paramsAtom')))
      addOnUpdate(anAsync, (ctx, patch) =>
        paramsAtom(
          ctx,
          patch.state.at(-1)?.params as undefined | ActionParams<T>,
        ),
      )

      anAsync.retry = action((ctx) => {
        const params = ctx.get(anAsync.paramsAtom!)
        throwReatomError(params === undefined, 'no cached params')
        return anAsync(ctx, ...params!) as ActionPayload<T>
      }, anAsync.__reatom.name?.concat('.retry'))

      const retriesCountAtom = atom(0)
      addOnUpdate(anAsync.retry, (ctx) => retriesCountAtom(ctx, (s) => ++s))
      addOnUpdate(anAsync.onFulfill, (ctx) => retriesCountAtom(ctx, 0))

      if (onReject) {
        addOnUpdate(anAsync.onReject, (ctx, { state }) => {
          if (state.length === 0) return

          const timeout =
            onReject(ctx, state.at(-1)!.payload, ctx.get(retriesCountAtom)) ??
            -1

          if (timeout < 0) return

          if (timeout === 0) {
            anAsync.retry!(ctx)
          } else {
            const effectState = ctx.get(anAsync)
            setTimeout(
              () =>
                effectState === ctx.get(anAsync) &&
                state === ctx.get(anAsync.onReject) &&
                anAsync.retry!(ctx),
              timeout,
            )
          }
        })
      }
    }

    return anAsync as T & {
      paramsAtom: Atom<undefined | ActionParams<T>>
      retry: Action<[], ActionPayload<T>>
    }
  }

// TODO extra methods with different retry policies
// TODO `withCache`

// export interface AsyncStatus {
//   // status: 'INIT' | 'FIRST_LOADING' | 'ANOTHER_LOADING',
//   isLoaded: boolean
//   isLoading: boolean
//   isError: boolean
//   isTouched: boolean
// }
// export const withStatusAtom =
//   <T extends AsyncAction & { statusAtom?: Atom<AsyncStatus> }>(): Fn<
//     [T],
//     T & { statusAtom: Atom<AsyncStatus> }
//   > =>
//   (anAsync) => {
//     const statusAtom = (anAsync.statusAtom = unstable_reatomPassiveComputed(
//       {
//         onFulfill: anAsync.onFulfill,
//         pending: anAsync.pendingAtom,
//       },
//       (ctx, shape) => {
//         const isLoaded = ctx.cause!.state.isLoaded || shape.onFulfill.length > 0
//         const isLoading = shape.pending > 0
//         const isError = boolean
//         const isTouched = boolean
//       },
//       anAsync.__reatom.name?.concat('.statusAtom'),
//     ))

//     return anAsync as T & { onAbort: any }
//   }
