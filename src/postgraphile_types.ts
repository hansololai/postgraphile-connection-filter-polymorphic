import { Build } from 'postgraphile';
import {
  PgAttribute,
  PgProc,
  PgClass,
  PgConstraint,
  PgExtension,
  PgType,
  PgNamespace,
} from 'graphile-build-pg';
import { PgIndex } from 'graphile-build-pg/node8plus/plugins/PgIntrospectionPlugin';

export type GraphilePgAttribute = PgAttribute;
export type GraphilePgProcedure = PgProc;

export interface GraphilePgConstraint extends Omit<PgConstraint, 'foreignClass' | 'class'> {
  foreignClass: GraphilePgClass;
  class: GraphilePgClass;
}
export interface GraphilePgClass extends Omit<PgClass, 'constraints' | 'attributes'> {
  constraints: GraphilePgConstraint[];
  attributes: PgAttribute[];
}
export interface GraphilePgIntrospection {
  __pgVersion: number;
  attribute: PgAttribute[];
  attributeByClassIdAndNum: { [classId: string]: { [num: string]: PgAttribute } };
  class: GraphilePgClass[];
  classById: { [x: string]: GraphilePgClass };
  constraint: GraphilePgConstraint[];
  extension: PgExtension[];
  extensionById: { [x: string]: PgExtension };
  index: PgIndex[];
  namespace: PgNamespace[];
  namespaceById: { [x: string]: PgNamespace };
  procedure: PgProc[];
  type: PgType[];
  typeById: { [x: string]: PgType };
}
export interface GraphileBuild extends Build {
  pgIntrospectionResultsByKind: GraphilePgIntrospection;
}
