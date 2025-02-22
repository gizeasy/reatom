import { atom, AtomMut } from '@reatom/core'
import { withReset } from './withReset'
import { WithReducers } from './withReducers'

export type StringAtom<State extends string = string> = WithReducers<
  AtomMut<State>,
  {
    reset: () => State
  }
>

export const reatomString: {
  (initState?: string, name?: string): StringAtom
  <T extends string>(initState: T, name?: string): StringAtom<T>
} = (initState = '' as string, name?: string) =>
  atom(initState, name).pipe(withReset())
