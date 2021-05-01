// tracing: off

import { pipe } from "@effect-ts/core"
import { Tagged } from "@effect-ts/core/Case"
import type { Tuple } from "@effect-ts/core/Collections/Immutable/Tuple"
import * as Tp from "@effect-ts/core/Collections/Immutable/Tuple"
import * as T from "@effect-ts/core/Effect"
import * as E from "@effect-ts/core/Either"
import type { Option } from "@effect-ts/core/Option"
import * as O from "@effect-ts/core/Option"
import { matchTag } from "@effect-ts/core/Utils"
import * as Q from "@effect-ts/query/Query"
import type * as MO from "@effect-ts/schema"
import * as Encoder from "@effect-ts/schema/Encoder"
import * as Parser from "@effect-ts/schema/Parser"
import * as React from "react"

import type { ReactEnv } from "../Env"

export interface CacheCodec<A extends readonly unknown[], E, B> {
  to: (args: A, res: E.Either<E, B>) => Option<Tuple<[string, string]>>
  from: (args: A, map: Record<string, string>) => Option<E.Either<E, B>>
}

export const prefetchSymbol = Symbol.for("@effect-ts/react/query/prefetch")

export interface PrefetchContext {
  [prefetchSymbol]: {
    map: Record<string, string>
  }
}

export function isPrefetchContext(u: unknown): u is PrefetchContext {
  return typeof u === "object" && u != null && prefetchSymbol in u
}

export const queries = new Map()

export function query<A extends unknown[], R, E, B>(
  f: (...args: A) => Q.Query<R, E, B>,
  cacheCodec?: CacheCodec<A, E, B>
): (...args: A) => Q.Query<R, E, B> {
  if (cacheCodec) {
    const patched = (...args: A) =>
      Q.chain_(Q.fromEffect(T.environment()), (env) =>
        isPrefetchContext(env)
          ? Q.chain_(Q.either(f(...args)), (res) => {
              const toMap = cacheCodec.to(args, res)
              if (toMap._tag === "Some") {
                env[prefetchSymbol].map[toMap.value.get(0)] = toMap.value.get(1)
              }
              return Q.fromEither(res)
            })
          : f(...args)
      )

    queries.set(patched, cacheCodec)

    return patched
  }
  return f
}

export function successCodec<
  A extends readonly unknown[],
  E,
  Self extends MO.SchemaUPI
>(model: Self, key: (...args: A) => string): CacheCodec<A, E, MO.ParsedShapeOf<Self>> {
  const parseModel = Parser.for(model)
  const encodeModel = Encoder.for(model)
  return {
    from: (args, map) => fromCache(map, key(...args), parseModel),
    to: (args, res) => toCache(encodeModel, key(...args), res)
  }
}

export function toCache<E, Self extends MO.SchemaUPI>(
  encodeModel: Encoder.Encoder<any, any>,
  key: string,
  res: E.Either<E, MO.ParsedShapeOf<Self>>
): O.Option<Tp.Tuple<[string, string]>> {
  return res._tag === "Right"
    ? O.some(Tp.tuple(key, JSON.stringify(encodeModel(res.right))))
    : O.none
}

export function fromCache<E, Self extends MO.SchemaUPI>(
  map: Record<string, string>,
  key: string,
  parseModel: Parser.Parser<unknown, any, any>
): O.Option<E.Either<E, MO.ParsedShapeOf<Self>>> {
  return map[key]
    ? pipe(
        parseModel(JSON.parse(map[key]!)).effect,
        O.fromEither,
        O.map(({ tuple: [x] }) => E.right(x))
      )
    : O.none
}

export class Loading extends Tagged("Loading")<{}> {}

export class Done<E, A> extends Tagged("Done")<{ readonly current: E.Either<E, A> }> {}

export class Refreshing<E, A> extends Tagged("Refreshing")<{
  readonly current: E.Either<E, A>
}> {}

export type QueryResult<E, A> = Loading | Refreshing<E, A> | Done<E, A>

export const PrefetchContext = React.createContext({})

export function useQuery<A extends unknown[], R, E, B>(
  env: ReactEnv<R>,
  f: (...args: A) => Q.Query<R, E, B>,
  ...args: A
): QueryResult<E, B> {
  const cache = React.useContext(PrefetchContext)
  const codecCache = queries.get(f) as CacheCodec<any, any, any>
  const cached = codecCache.from(args, cache)
  const [last, setLast] = React.useState<{} | undefined>(undefined)

  const [state, updateState] = React.useState<QueryResult<E, B>>(
    O.getOrElse_(
      O.map_(cached, (e) => new Done({ current: e })),
      () => new Loading()
    )
  )

  env.useEffect(() => {
    if (cache !== last) {
      setLast(cache)

      const codecCache = queries.get(f) as CacheCodec<any, any, any>
      const cached = codecCache.from(args, cache)
      if (cached._tag === "Some") {
        return T.succeedWith(() => {
          updateState((_) => new Done({ current: cached.value }))
        })
      }
    }

    return pipe(
      T.succeedWith(() => {
        updateState(
          state["|>"](
            matchTag({
              Done: (_) => new Refreshing({ current: _.current }),
              Refreshing: (_) => _,
              Loading: (_) => _
            })
          )
        )
      }),
      T.zipRight(T.suspend(() => Q.run(f(...args)))),
      T.either,
      T.chain((done) =>
        T.succeedWith(() => {
          updateState((_) => new Done({ current: done }))
        })
      )
    )
  }, args)

  return state
}

export function PrefetchProvider({
  children,
  prefetch
}: {
  prefetch?: string
  children: React.ReactNode
}) {
  return (
    <PrefetchContext.Provider value={prefetch ? JSON.parse(prefetch) : {}}>
      {children}
    </PrefetchContext.Provider>
  )
}

export function prefetch<R, E, A>(query: Q.Query<R, E, A>): T.Effect<R, never, string> {
  return Q.run(
    Q.chain_(Q.fromEffect(T.succeedWith(() => ({}))), (map) =>
      Q.map_(
        Q.provideSome_(Q.either(query), "CollectPrefetch", (r: R) => ({
          ...r,
          [prefetchSymbol]: {
            map
          }
        })),
        () => JSON.stringify(map)
      )
    )
  )
}
