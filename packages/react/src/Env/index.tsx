// tracing: off

import * as Tp from "@effect-ts/core/Collections/Immutable/Tuple"
import * as T from "@effect-ts/core/Effect"
import * as Ex from "@effect-ts/core/Effect/Exit"
import * as F from "@effect-ts/core/Effect/Fiber"
import * as L from "@effect-ts/core/Effect/Layer"
import * as RM from "@effect-ts/core/Effect/Managed/ReleaseMap"
import * as P from "@effect-ts/core/Effect/Promise"
import * as Ref from "@effect-ts/core/Effect/Ref"
import type { Lazy } from "@effect-ts/core/Function"
import { pipe } from "@effect-ts/core/Function"
import * as React from "react"

class MainProvider<R> {
  constructor(
    readonly allocate: T.Effect<T.DefaultEnv, never, boolean>,
    readonly release: T.UIO<void>,
    readonly provide: <E1, A1>(self: T.Effect<R, E1, A1>) => T.Effect<unknown, E1, A1>
  ) {}
}

function unsafeMainProvider<R>(self: L.Layer<T.DefaultEnv, never, R>) {
  const promise = P.unsafeMake<never, R>(F.None)
  const relMap = new RM.ReleaseMap(
    Ref.unsafeMakeRef<RM.State>(new RM.Running(0, new Map()))
  )

  return new MainProvider<R>(
    pipe(
      L.build(self).effect,
      T.provideSome((r: T.DefaultEnv) => Tp.tuple(r, relMap)),
      T.map((_) => _.get(1)),
      T.foldCauseM(
        (cause) =>
          pipe(
            P.halt_(promise, cause),
            T.chain(() => T.halt(cause))
          ),
        (r) => P.succeed(r)(promise)
      )
    ),
    T.descriptorWith((d) =>
      RM.releaseAll(Ex.interrupt(d.id), T.sequential)(relMap)["|>"](T.asUnit)
    ),
    (self) =>
      pipe(
        P.await(promise),
        T.chain((env) => T.provideAll_(self, env))
      )
  )
}

export interface ServiceContext<R> {
  readonly provide: <E, A>(self: T.Effect<R, E, A>) => T.Effect<unknown, E, A>
}

export interface ReactEnv<R> {
  readonly Provider: React.FC<{
    layer: L.Layer<T.DefaultEnv, never, R>
  }>
  readonly useEffect: (self: Lazy<T.RIO<R, void>>, deps: unknown[]) => void
  readonly ServiceContext: React.Context<ServiceContext<R>>
}

export function make<R>(): ReactEnv<R> {
  const MissingContext = T.die(
    "service context not provided, wrap your app in LiveServiceContext"
  )

  const ServiceContext = React.createContext<ServiceContext<R>>({
    provide: () => MissingContext
  })

  const Provider: React.FC<{
    layer: L.Layer<T.DefaultEnv, never, R>
  }> = ({ children, layer }) => {
    const provider = React.useMemo(() => unsafeMainProvider(layer), [])

    React.useEffect(() => {
      const cancel = T.runCancel(provider.allocate)
      return () => {
        T.run(cancel)
        T.run(provider.release)
      }
    }, [])

    return (
      <ServiceContext.Provider value={{ provide: provider.provide }}>
        {children}
      </ServiceContext.Provider>
    )
  }

  function useEffect(self: Lazy<T.RIO<R, void>>, deps?: unknown[]) {
    const { provide } = React.useContext(ServiceContext)
    React.useEffect(() => {
      const fiber = T.runFiber(provide(self()))
      return () => {
        T.run(F.interrupt(fiber))
      }
    }, deps)
  }

  return {
    Provider,
    useEffect,
    ServiceContext
  }
}
