import { SchemaBuilder, Options } from 'postgraphile';
import {
  PgPolymorphicConstraintByName, PgPolymorphicConstraint,
} from './pgDefinePolymorphicCustomPlugin';
export interface BackwardPolyRelationSpecType {
  table: any;
  foreignTable: any;
  fieldName: string;
  tablePrimaryKey: any;
  constraint: PgPolymorphicConstraint;
  isOneToMany: boolean;
}
export const addBackwardPolyRelationFilter = (builder: SchemaBuilder, option: Options) => {
  // First add an inflector for polymorphic backrelation type name
  builder.hook('inflection', inflection => ({
    ...inflection,
    filterManyPolyType(table, foreignTable) {
      return `${this.filterManyType(table, foreignTable)}Poly`;
    },
  }));
  const { pgSimpleCollections } = option;
  const hasConnections = pgSimpleCollections !== 'only';
  builder.hook('GraphQLInputObjectType:fields', (fields, build, context) => {
    const {
      describePgEntity,
      extend,
      newWithHooks,
      inflection,
      pgOmit: omit,
      pgSql: sql,
      pgIntrospectionResultsByKind: introspectionResultsByKind,
      graphql: { GraphQLInputObjectType, GraphQLBoolean },
      connectionFilterResolve,
      connectionFilterRegisterResolver,
      connectionFilterTypesByTypeName,
      connectionFilterType,
      mapFieldToPgTable,
      pgPolymorphicClassAndTargetModels = [],
    } = build;
    const {
      fieldWithHooks,
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
      .reduce((memo, currentPoly) => {
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
        const primaryConstraint = introspectionResultsByKind.constraint.find(
          attr => attr.classId === table.id && attr.type === 'p',
        );
        const sourceTableId = `${currentPoly.name}_id`;
        const sourceTableType = `${currentPoly.name}_type`;
        const isForeignKeyUnique = introspectionResultsByKind.constraint.find((c) => {
          if (c.classId !== foreignTable.id) return false;
          // Only if the xxx_type, xxx_id are unique constraint
          if (c.keyAttributeNums.length !== 2) return false;
          // It must be an unique constraint
          if (c.type !== 'u') return false;
          // the two attributes must be xx_type, xx_id
          if (!c.keyAttributes.find(a => a.name === sourceTableId)) return false;
          if (!c.keyAttributes.find(a => a.name === sourceTableType)) return false;
          return true;
        });
        const fieldName = isForeignKeyUnique ? inflection.camelCase(
          inflection.singularize(foreignTable.name))
          : inflection.camelCase(inflection.pluralize(foreignTable.name));

        memo.push({
          table,
          fieldName,
          foreignTable,
          tablePrimaryKey: primaryConstraint.keyAttributes[0],
          isOneToMany: !isForeignKeyUnique,
          constraint: currentPoly,
        });
        return memo;
      }, [] as BackwardPolyRelationSpecType[]);

    let backwardRelationSpecByFieldName: { [x: string]: BackwardPolyRelationSpecType } = {};

    const addField = (fieldName, description, type, resolve, spec, hint) => {
      // Field
      newFields = extend(
        newFields,
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
      backwardRelationSpecByFieldName = extend(backwardRelationSpecByFieldName, {
        [fieldName]: spec,
      });
      // Resolver
      connectionFilterRegisterResolver(Self.name, fieldName, resolve);
    };

    for (const spec of backwardRelationSpecs) {
      const { foreignTable, constraint, tablePrimaryKey, fieldName, isOneToMany } = spec;
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
          addField(
            fieldName,
            `Filter by the object’s \`${fieldName}\` relation.`,
            FilterManyType,
            makeResolveMany(spec),
            spec,
            `Adding connection filter backward relation field from ${describePgEntity(
              table,
            )} to ${describePgEntity(foreignTable)}`,
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
        );
      }
    }

    function resolveSingle({ sourceAlias, fieldName, fieldValue, queryBuilder }) {
      if (fieldValue == null) return null;

      const {
        foreignTable,
        table,
        constraint,
        tablePrimaryKey,
      } = backwardRelationSpecByFieldName[fieldName];

      const foreignTableTypeName = inflection.tableType(foreignTable);
      const foreignTableAlias = sql.identifier(Symbol());
      const sqlIdentifier = sql.identifier(
        foreignTable.namespace.name,
        foreignTable.name,
      );
      const tableTypeName = inflection.tableType(table);
      const sourceTableId = `${constraint.name}_id`;
      const sourceTableType = `${constraint.name}_type`;
      const foreignTableFilterTypeName = inflection.filterType(foreignTableTypeName);

      const sqlKeysMatch = sql.query`(${sql.fragment`${foreignTableAlias}.${sql.identifier(
        sourceTableId,
      )} = ${sourceAlias}.${sql.identifier(tablePrimaryKey.name)}`}) and (
        ${sql.fragment`${foreignTableAlias}.${sql.identifier(
        sourceTableType,
      )} = ${sql.value(tableTypeName)}`})`;

      const sqlSelectWhereKeysMatch = sql.query`select 1 from ${sqlIdentifier}
        as ${foreignTableAlias} where ${sqlKeysMatch}`;
      const sqlFragment = connectionFilterResolve(
        fieldValue,
        foreignTableAlias,
        foreignTableFilterTypeName,
        queryBuilder,
      );
      return sqlFragment == null
        ? null
        : sql.query`exists(${sqlSelectWhereKeysMatch} and (${sqlFragment}))`;
    }

    function makeResolveMany(backwardRelationSpec) {
      return function resolveMany({ sourceAlias, fieldName, fieldValue, queryBuilder }) {
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

    const resolve = ({ sourceAlias, fieldName, fieldValue, queryBuilder }) => {
      if (fieldValue == null) return null;

      // foreignTable is the polymorphic table, like tags, notes,
      const {
        foreignTable, table, constraint, tablePrimaryKey,
      } = backwardRelationSpec as BackwardPolyRelationSpecType;
      const foreignTableAlias = sql.identifier(Symbol());
      const sqlIdentifier = sql.identifier(foreignTable.namespace.name, foreignTable.name);
      const tableTypeName = inflection.tableType(table);
      const sourceTableId = `${constraint.name}_id`;
      const sourceTableType = `${constraint.name}_type`;

      const sqlKeysMatch = sql.query`(${sql.fragment`${foreignTableAlias}.${sql.identifier(
        sourceTableId,
      )} = ${sourceAlias}.${sql.identifier(tablePrimaryKey.name)}`}) and (
        ${sql.fragment`${foreignTableAlias}.${sql.identifier(sourceTableType)} = ${sql.value(
        tableTypeName,
      )}`})`;

      const sqlSelectWhereKeysMatch = sql.query`select 1 from ${sqlIdentifier} as
        ${foreignTableAlias} where ${sqlKeysMatch}`;

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
