// tracing: off

import type * as T from "@effect-ts/core/Effect"
import type * as L from "@effect-ts/core/Effect/Layer"
import type * as Q from "@effect-ts/query/Query"
import * as React from "react"

import * as DataSource from "./DataSource"
import * as Env from "./Env"
import * as Query from "./Query"

export { ticked as dataSource } from "./DataSource"
export { useHub, useSubscribe } from "./Hub"
export {
  Done,
  Loading,
  prefetch,
  query,
  QueryResult,
  Refreshing,
  successCodec
} from "./Query"

export function makeApp<R extends T.DefaultEnv>() {
  const env = Env.make<R>()

  const Provide: React.FC<{
    layer: L.Layer<T.DefaultEnv, never, R>
    sources: Iterable<DataSource.Ticked<R, any>>
    prefetch?: string
  }> = ({ children, layer, prefetch, sources }) => {
    return (
      <env.Provider layer={layer}>
        <DataSource.DataSourceProvider env={env} sources={sources}>
          <Query.PrefetchProvider prefetch={prefetch}>
            {children}
          </Query.PrefetchProvider>
        </DataSource.DataSourceProvider>
      </env.Provider>
    )
  }

  function useQuery<A extends unknown[], E, B>(
    f: (...args: A) => Q.Query<R, E, B>,
    ...args: A
  ): Query.QueryResult<E, B> {
    return Query.useQuery(env, f, ...args)
  }

  function useProvider() {
    const _ = React.useContext(env.ServiceContext)
    return _.provide
  }

  return {
    Provide,
    useQuery,
    useProvider
  }
}
