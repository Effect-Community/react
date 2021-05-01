// tracing: off

import { pipe } from "@effect-ts/core"
import * as T from "@effect-ts/core/Effect"
import * as S from "@effect-ts/core/Effect/Experimental/Stream"
import * as F from "@effect-ts/core/Effect/Fiber"
import * as H from "@effect-ts/core/Effect/Hub"
import type { Lazy } from "@effect-ts/core/Function"
import * as React from "react"

export type UseHub<A> = [Lazy<S.Stream<unknown, never, A>>, (a: A) => void]

export function useHub<A>(): UseHub<A> {
  const deps: never[] = []
  const hub = React.useMemo(() => H.unsafeMakeUnbounded<A>(), deps)
  const subscribe = React.useCallback(() => S.fromHub(hub), deps)
  const publisher = React.useCallback((a) => {
    T.run(H.publish_(hub, a))
  }, deps)
  return [subscribe, publisher]
}

export function useSubscribe<A>(
  initial: A,
  subscribe: Lazy<S.Stream<unknown, never, A>>,
  deps: unknown[]
): A {
  const [state, updateState] = React.useState(initial)

  React.useEffect(() => {
    const fiber = T.runFiber(
      pipe(
        subscribe(),
        S.mapM((a) =>
          T.succeedWith(() => {
            updateState(a)
          })
        ),
        S.runDrain,
        T.onInterrupt(() =>
          T.succeedWith(() => {
            updateState(initial)
          })
        )
      )
    )
    return () => {
      T.run(F.interrupt(fiber))
    }
  }, deps)

  return state
}
