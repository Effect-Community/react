// tracing: off

import { pipe } from "@effect-ts/core"
import * as Chunk from "@effect-ts/core/Collections/Immutable/Chunk"
import * as Tp from "@effect-ts/core/Collections/Immutable/Tuple"
import * as T from "@effect-ts/core/Effect"
import * as Prom from "@effect-ts/core/Effect/Promise"
import * as Queue from "@effect-ts/core/Effect/Queue"
import * as CRM from "@effect-ts/query/CompletedRequestMap"
import * as DS from "@effect-ts/query/DataSource"
import * as Q from "@effect-ts/query/Query"
import type * as Req from "@effect-ts/query/Request"
import * as React from "react"

import type { ReactEnv } from "../Env"

export class Ticked<R, A extends Req.Request<any, any>> extends DS.DataSource<R, A> {
  private queue = Queue.unsafeMakeUnbounded<
    Tp.Tuple<
      [Chunk.Chunk<Chunk.Chunk<A>>, Prom.Promise<never, CRM.CompletedRequestMap>]
    >
  >()

  constructor(readonly ds: DS.DataSource<R, A>) {
    super(`Ticked(${ds.identifier})`, (requests: Chunk.Chunk<Chunk.Chunk<A>>) => {
      const queue = this.queue

      return T.gen(function* (_) {
        const promise = yield* _(Prom.make<never, CRM.CompletedRequestMap>())

        yield* _(queue["|>"](Queue.offer(Tp.tuple(requests, promise))))

        return yield* _(Prom.await(promise))
      })
    })
  }

  readonly tick = pipe(
    this.queue,
    Queue.takeAll,
    T.chain((batches) =>
      pipe(
        batches,
        Q.forEachPar(({ tuple: [r, p] }) =>
          pipe(
            r,
            Q.forEach(
              Q.forEachPar((a) =>
                pipe(
                  Q.fromRequest(a, this.ds),
                  Q.either,
                  Q.map((res) => Tp.tuple(a, res))
                )
              )
            ),
            Q.chain((as) =>
              pipe(
                p,
                Prom.succeed(
                  pipe(
                    as,
                    Chunk.reduce(CRM.empty, (crm, ser) =>
                      pipe(
                        ser,
                        Chunk.reduce(crm, (crm, { tuple: [a, res] }) =>
                          CRM.insert_(crm, a, res)
                        )
                      )
                    )
                  )
                ),
                Q.fromEffect
              )
            )
          )
        ),
        Q.run,
        T.asUnit
      )
    )
  )
}

export function ticked<R, A extends Req.Request<any, any>>(ds: DS.DataSource<R, A>) {
  return new Ticked(ds)
}

export function Provider<R extends T.DefaultEnv>({
  children,
  env,
  sources
}: {
  env: ReactEnv<R>
  sources: Iterable<Ticked<R, any>>
  children: React.ReactNode
}) {
  env.useEffect(
    () =>
      T.forever(
        T.forEach_(sources, ({ tick }) => T.fork(tick))["|>"](T.zipRight(T.sleep(0)))
      )["|>"](T.awaitAllChildren),
    []
  )
  return <>{children}</>
}
