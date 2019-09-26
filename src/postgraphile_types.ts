import { Build } from 'postgraphile';
import { PgAttribute, PgProc, PgConstraint, PgClass } from 'graphile-build-pg';

export type GraphilePgAttribute = PgAttribute;
export type GraphilePgProcedure = PgProc;
export interface GraphilePgConstraint extends PgConstraint{
  foreignClass: GraphilePgClass;
}
export interface GraphilePgClass extends PgClass{
  constraints: [GraphilePgConstraint];
}
export interface GraphilePgIntrospection {
  classById: {[x: string]: GraphilePgClass};
  constraint: GraphilePgConstraint[];
  class: GraphilePgClass[];
  procedure: GraphilePgProcedure[];
  [x: string]: any;
}
export interface GraphileBuild extends Build {
  pgIntrospectionResultsByKind: GraphilePgIntrospection;
}
