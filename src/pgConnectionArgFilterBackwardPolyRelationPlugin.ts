import { SchemaBuilder, Options, Build, Inflection } from 'postgraphile';
import {
  PgPolymorphicConstraintByName,
  PgPolymorphicConstraint,
} from './pgDefinePolymorphicCustomPlugin';
import { GraphilePgClass, GraphilePgAttribute, GraphileBuild } from './postgraphile_types';
import { GraphQLObjectType } from 'graphql';
import { QueryBuilder } from 'graphile-build-pg';
import { ForwardPolyRelationSpecType } from './pgConnectionArgFilterForwardPolyRelationPlugin';
export interface BackwardPolyRelationSpecType {
  table: GraphilePgClass;
  foreignTable: GraphilePgClass;
  fieldName: string;
  tablePrimaryKey: GraphilePgAttribute;
  constraint: PgPolymorphicConstraint;
  isOneToMany: boolean;
}

type SqlFragment = any;

export interface ResolveFieldProps {
  sourceAlias: string;
  fieldName: string;
  fieldValue: any;
  queryBuilder: QueryBuilder;
}
export type ResolveFieldFunc = (prop: ResolveFieldProps) => SqlFragment | null;

interface GetSqlSelectWhereKeysMatchProps{
  sourceAlias: string;
  foreignTableAlias: string;
  foreignTable: GraphilePgClass;
  table: GraphilePgClass;
  constraint: PgPolymorphicConstraint;
  tablePrimaryKey: GraphilePgAttribute ;
  sql: any;
  inflection: Inflection;
}
const getSqlSelectWhereKeysMatch = ({
  sourceAlias,
  foreignTableAlias,
  foreignTable,
  table,
  constraint,
  tablePrimaryKey,
  sql,
  inflection,
}: GetSqlSelectWhereKeysMatchProps) => {
  const sourceTableId = `${constraint.name}_id`;
  const sourceTableType = `${constraint.name}_type`;
  const tableTypeName = inflection.tableType(table);
  const sqlIdentifier = sql.identifier(foreignTable.namespace.name, foreignTable.name);

  const sqlKeysMatch = sql.query`(${sql.fragment`${foreignTableAlias}.${sql.identifier(
    sourceTableId,
  )} = ${sourceAlias}.${sql.identifier(tablePrimaryKey.name)}`}) and (
  ${sql.fragment`${foreignTableAlias}.${sql.identifier(sourceTableType)} = ${sql.value(
    tableTypeName,
  )}`})`;
  const sqlSelectWhereKeysMatch = sql.query`select 1 from ${sqlIdentifier} as
  ${foreignTableAlias} where ${sqlKeysMatch}`;

  return sqlSelectWhereKeysMatch;
};
export const addField = (
  fieldName: string,
  description: string,
  type: GraphQLObjectType,
  resolve: ResolveFieldFunc,
  spec: BackwardPolyRelationSpecType | ForwardPolyRelationSpecType,
  hint: string,
  build: Build,
  fields: any,
  relationSpecByFieldName: {
    [x: string]: BackwardPolyRelationSpecType|ForwardPolyRelationSpecType },
  context: any,
) => {
  const { extend, connectionFilterRegisterResolver } = build;
  const { fieldWithHooks, Self } = context;
  // Field
  const toReturn = extend(
    fields,
    {
      [fieldName]: fieldWithHooks(
        fieldName,
        {
          description,
          type,
        },
        {
          isPgConnectionFilterField: true,
        },
      ),
    },
    hint,
  );
  // Relation spec for use in resolver
  relationSpecByFieldName[fieldName] = spec;
  // Resolver
  connectionFilterRegisterResolver(Self.name, fieldName, resolve);
  return toReturn;
};
export const addBackwardPolyRelationFilter = (builder: SchemaBuilder, option: Options) => {
  // First add an inflector for polymorphic backrelation type name
  builder.hook('inflection', inflection => ({
    ...inflection,
    filterManyPolyType(table: GraphilePgClass, foreignTable: GraphilePgClass) {
      return `${this.filterManyType(table, foreignTable)}Poly`;
    },
    backwardRelationByPolymorphic(
      table: GraphilePgClass,
      polyConstraint: PgPolymorphicConstraint,
      isUnique: boolean,
    ) {
      const { backwardAssociationName } = polyConstraint;
      const name = backwardAssociationName || table.name;
      const fieldName = isUnique ? this.singularize(name) : this.pluralize(name);
      // return this.camelCase(`${fieldName}-as-${polymorphicName}`);
      return this.camelCase(fieldName);
    },
  }));
  // const { pgSimpleCollections } = option;
  // const hasConnections = pgSimpleCollections !== 'only';
  builder.hook('GraphQLInputObjectType:fields', (fields, build, context) => {
    const {
      describePgEntity,
      newWithHooks,
      inflection,
      pgOmit: omit,
      pgSql: sql,
      pgIntrospectionResultsByKind: introspectionResultsByKind,
      graphql: { GraphQLInputObjectType },
      connectionFilterResolve,
      connectionFilterTypesByTypeName,
      connectionFilterType,
      mapFieldToPgTable,
      pgPolymorphicClassAndTargetModels = [],
    } = build as GraphileBuild;
    const {
      scope: { pgIntrospection: table, isPgConnectionFilter },
      Self,
    } = context;

    if (!isPgConnectionFilter || table.kind !== 'class') return fields;
    if (!mapFieldToPgTable) {
      throw new Error(
        'mapFieldToPgTable is not defined in build, \
        you might missed plugin to run before this plugin',
      );
    }

    let newFields = fields;
    connectionFilterTypesByTypeName[Self.name] = Self;

    const modelName = inflection.tableType(table);

    const backwardRelationSpecs = (<PgPolymorphicConstraintByName>pgPolymorphicClassAndTargetModels)
      .filter(con => con.to.includes(modelName))
      // .filter((con) => con.type === 'f')
      // .filter((con) => con.foreignClassId === table.id)
      .reduce(
        (memo, currentPoly) => {
          // if (omit(foreignConstraint, 'read')) {
          //   return memo;
          // }
          const foreignTable = introspectionResultsByKind.classById[currentPoly.from];
          if (!foreignTable) {
            return memo;
            // throw new Error(
            //   `Could not find the foreign table (polymorphicName: ${currentPoly.name})`,
            // );
          }
          if (omit(foreignTable, 'read')) {
            return memo;
          }
          const primaryConstraint = introspectionResultsByKind.constraint.find(attr =>
            attr.classId === table.id && attr.type === 'p',
          );
          if (!primaryConstraint) {
            return memo;
          }
          const sourceTableId = `${currentPoly.name}_id`;
          const sourceTableType = `${currentPoly.name}_type`;
          const isForeignKeyUnique = introspectionResultsByKind.constraint.find((c) => {
            // Only if the xxx_type, xxx_id are unique constraint
            // It must be an unique constraint
            if (
              c.classId !== foreignTable.id ||
              c.keyAttributeNums.length !== 2 ||
              c.type !== 'u' ||
              !c.keyAttributes.find(a => a.name === sourceTableId) ||
              !c.keyAttributes.find(a => a.name === sourceTableType)
            ) {
              return false;
            }
            // the two attributes must be xx_type, xx_id
            return true;
          });
          const fieldName = inflection.backwardRelationByPolymorphic(
            foreignTable,
            currentPoly,
            isForeignKeyUnique,
          );

          memo.push({
            table,
            fieldName,
            foreignTable,
            tablePrimaryKey: primaryConstraint.keyAttributes[0],
            isOneToMany: !isForeignKeyUnique,
            constraint: currentPoly,
          });
          return memo;
        },
        [] as BackwardPolyRelationSpecType[],
      );

    const backwardRelationSpecByFieldName: { [x: string]: BackwardPolyRelationSpecType } = {};

    const resolveSingle: ResolveFieldFunc = ({
      sourceAlias,
      fieldName,
      fieldValue,
      queryBuilder,
    }) => {
      if (fieldValue == null) return null;

      const { foreignTable, table, constraint, tablePrimaryKey,
      } = backwardRelationSpecByFieldName[fieldName];

      const foreignTableTypeName = inflection.tableType(foreignTable);
      const foreignTableAlias = sql.identifier(Symbol());

      const foreignTableFilterTypeName = inflection.filterType(foreignTableTypeName);

      const sqlSelectWhereKeysMatch = getSqlSelectWhereKeysMatch({
        sourceAlias,
        foreignTableAlias,
        foreignTable,
        table,
        constraint,
        tablePrimaryKey,
        sql,
        inflection,
      });

      const sqlFragment = connectionFilterResolve(
        fieldValue,
        foreignTableAlias,
        foreignTableFilterTypeName,
        queryBuilder,
      );
      return sqlFragment == null
        ? null
        : sql.query`exists(${sqlSelectWhereKeysMatch} and (${sqlFragment}))`;
    };

    function makeResolveMany(backwardRelationSpec: BackwardPolyRelationSpecType) {
      const resolveMany: ResolveFieldFunc = ({
        sourceAlias, fieldName, fieldValue, queryBuilder }) => {
        if (fieldValue == null) return null;

        const { foreignTable } = backwardRelationSpecByFieldName[fieldName];

        const foreignTableFilterManyTypeName = inflection.filterManyPolyType(table, foreignTable);
        const sqlFragment = connectionFilterResolve(
          fieldValue,
          sourceAlias,
          foreignTableFilterManyTypeName,
          queryBuilder,
          null,
          null,
          null,
          { backwardRelationSpec },
        );
        return sqlFragment == null ? null : sqlFragment;
      };
      return resolveMany;
    }
    for (const spec of backwardRelationSpecs) {
      const { foreignTable, fieldName, isOneToMany } = spec;
      const foreignTableTypeName = inflection.tableType(foreignTable);
      const foreignTableFilterTypeName = inflection.filterType(foreignTableTypeName);
      const ForeignTableFilterType = connectionFilterType(
        newWithHooks,
        foreignTableFilterTypeName,
        foreignTable,
        foreignTableTypeName,
      );
      if (!ForeignTableFilterType) continue;

      if (isOneToMany) {
        if (!omit(foreignTable, 'many')) {
          const filterManyTypeName = inflection.filterManyPolyType(table, foreignTable);
          if (!connectionFilterTypesByTypeName[filterManyTypeName]) {
            connectionFilterTypesByTypeName[filterManyTypeName] = newWithHooks(
              GraphQLInputObjectType,
              {
                name: filterManyTypeName,
                description: `A filter to be used against many \`${foreignTableTypeName}\` object
                 through polymorphic types. All fields are combined with a logical ‘and.’`,
              },
              {
                foreignTable,
                isPgConnectionFilterManyPoly: true,
                backwardRelationSpec: spec,
              },
            );
          }
          const FilterManyType = connectionFilterTypesByTypeName[filterManyTypeName];
          newFields = addField(
            fieldName,
            `Filter by the object’s \`${fieldName}\` relation.`,
            FilterManyType,
            makeResolveMany(spec),
            spec,
            `Adding connection filter backward relation field from ${describePgEntity(
              table,
            )} to ${describePgEntity(foreignTable)}`,
            build,
            newFields,
            backwardRelationSpecByFieldName,
            context,
          );
        }
      } else {
        addField(
          fieldName,
          `Filter by the object’s \`${fieldName}\` relation.`,
          ForeignTableFilterType,
          resolveSingle,
          spec,
          `Adding connection filter backward relation field from ${describePgEntity(
            table,
          )} to ${describePgEntity(foreignTable)}`,
          build,
          newFields,
          backwardRelationSpecByFieldName,
          context,
        );
      }
    }

    return newFields;
  });

  builder.hook('GraphQLInputObjectType:fields', (fields, build, context) => {
    const {
      extend,
      newWithHooks,
      inflection,
      pgSql: sql,
      connectionFilterResolve,
      connectionFilterRegisterResolver,
      connectionFilterTypesByTypeName,
      connectionFilterType,
    } = build;
    const {
      fieldWithHooks,
      scope: { foreignTable, isPgConnectionFilterManyPoly, backwardRelationSpec },
      Self,
    } = context;

    if (!isPgConnectionFilterManyPoly || !foreignTable) return fields;

    connectionFilterTypesByTypeName[Self.name] = Self;

    const foreignTableTypeName = inflection.tableType(foreignTable);
    const foreignTableFilterTypeName = inflection.filterType(foreignTableTypeName);
    const FilterType = connectionFilterType(
      newWithHooks,
      foreignTableFilterTypeName,
      foreignTable,
      foreignTableTypeName,
    );

    const manyFields = {
      every: fieldWithHooks(
        'every',
        {
          description: `Every related \`${foreignTableTypeName}\` matches the filter criteria. All fields are combined with a logical ‘and.’`,
          type: FilterType,
        },
        {
          isPgConnectionFilterManyField: true,
        },
      ),
      some: fieldWithHooks(
        'some',
        {
          description: `Some related \`${foreignTableTypeName}\` matches the filter criteria. All fields are combined with a logical ‘and.’`,
          type: FilterType,
        },
        {
          isPgConnectionFilterManyField: true,
        },
      ),
      none: fieldWithHooks(
        'none',
        {
          description: `No related \`${foreignTableTypeName}\` matches the filter criteria. All fields are combined with a logical ‘and.’`,
          type: FilterType,
        },
        {
          isPgConnectionFilterManyField: true,
        },
      ),
    };

    const resolve: ResolveFieldFunc = ({ sourceAlias, fieldName, fieldValue, queryBuilder }) => {
      if (fieldValue == null) return null;

      // foreignTable is the polymorphic table, like tags, notes,
      const {
        foreignTable,
        table,
        constraint,
        tablePrimaryKey,
      } = backwardRelationSpec as BackwardPolyRelationSpecType;
      const foreignTableAlias = sql.identifier(Symbol());
      const sqlSelectWhereKeysMatch = getSqlSelectWhereKeysMatch({
        sourceAlias,
        foreignTableAlias,
        foreignTable,
        table,
        constraint,
        tablePrimaryKey,
        sql,
        inflection,
      });
      const sqlFragment = connectionFilterResolve(
        fieldValue,
        foreignTableAlias,
        foreignTableFilterTypeName,
        queryBuilder,
      );
      if (sqlFragment == null) {
        return null;
      }
      if (fieldName === 'every') {
        return sql.query`not exists(${sqlSelectWhereKeysMatch} and not (${sqlFragment}))`;
      }
      if (fieldName === 'some') {
        return sql.query`exists(${sqlSelectWhereKeysMatch} and (${sqlFragment}))`;
      }
      if (fieldName === 'none') {
        return sql.query`not exists(${sqlSelectWhereKeysMatch} and (${sqlFragment}))`;
      }
      throw new Error(`Unknown field name: ${fieldName}`);
    };

    for (const fieldName of Object.keys(manyFields)) {
      connectionFilterRegisterResolver(Self.name, fieldName, resolve);
    }

    return extend(fields, manyFields);
  });
};
