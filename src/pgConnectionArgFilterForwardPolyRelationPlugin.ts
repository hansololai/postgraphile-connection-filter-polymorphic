import { SchemaBuilder, Options } from 'postgraphile';
import { PgPolymorphicConstraintByName, PgPolymorphicConstraint } from './pgDefinePolymorphicCustomPlugin';
import { addField } from './pgConnectionArgFilterBackwardPolyRelationPlugin';

export interface ForwardPolyRelationSpecType {
  table: any;
  foreignTable: any;
  fieldName: string;
  foreignPrimaryKey: any;
  constraint: PgPolymorphicConstraint;
}
export const addForwardPolyRelationFilter = (builder: SchemaBuilder) => {
  // builder.hook('inflection', (inflection) => ({
  //   ...inflection,
  //   filterForwardRelationExistsFieldName(relationFieldName) {
  //     return `${relationFieldName}Exists`;
  //   },
  // }));

  builder.hook('GraphQLInputObjectType:fields', (fields, build, context) => {
    const {
      describePgEntity,
      extend,
      newWithHooks,
      inflection,
      pgSql: sql,
      pgIntrospectionResultsByKind: introspectionResultsByKind,
      pgIntrospectionResultsByKind: { classById },
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
    let newFields = fields;

    if (!isPgConnectionFilter || table.kind !== 'class') return fields;
    if (!mapFieldToPgTable) {
      throw new Error(
        'mapFieldToPgTable is not defined in build, \
        you might missed plugin to run before this plugin',
      );
    }
    // A function convert the modelName to table.id
    const reFormatPolymorphicConstraint = (cur: PgPolymorphicConstraint) => {
      const newTo = cur.to
        .map((targetModelName) => {
          const t = mapFieldToPgTable[targetModelName];
          if (!t) {
            return null;
          }
          return classById[t.id];
        })
        .filter((c) => {
          return c && c.classKind === 'r';
        })
        .map((r) => {
          return r.id;
        });
      return { ...cur, to: newTo };
    };

    connectionFilterTypesByTypeName[Self.name] = Self;

    // Iterate the pgPolymorphic constraints and find the ones that are relavent to this table
    const forwardPolyRelationSpecs: ForwardPolyRelationSpecType[]
      = (<PgPolymorphicConstraintByName>pgPolymorphicClassAndTargetModels)
        .filter(con => con.from === table.id)
        .reduce((acc, currentPoly) => {
          const cur = reFormatPolymorphicConstraint(currentPoly);
          // For each polymorphic, we collect the following, using Tag as example
          // Suppose Tag can be tagged on User, Post via taggable_id and taggable_type
          // 1. target table objects. e.g. User, Post
          // 2. fieldNames e.g. UserAsTaggable, PostAsTaggable
          // 3. constraint name. e.g. taggable
          // 4. foreignTableAttribute e.g. 'id'
          const toReturn: ForwardPolyRelationSpecType[] = cur.to.reduce(
            (memo, curForeignTable) => {
              const foreignTable = classById[curForeignTable];
              if (!foreignTable) return memo;
              const fieldName = inflection.forwardRelationByPolymorphic(foreignTable, cur.name);
              const foreignPrimaryConstraint = introspectionResultsByKind.constraint.find(
                attr => attr.classId === foreignTable.id && attr.type === 'p',
              );
              if (foreignPrimaryConstraint && foreignPrimaryConstraint.keyAttributes[0]) {
                memo.push({
                  table,
                  foreignTable,
                  fieldName,
                  foreignPrimaryKey: foreignPrimaryConstraint.keyAttributes[0],
                  constraint: currentPoly,
                });
              }

              return memo;
            },
            [],
          );
          return [...acc, ...toReturn];
        }, [] as ForwardPolyRelationSpecType[]);

    let forwardPolyRelationSpecByFieldName: { [x: string]: ForwardPolyRelationSpecType } = {};

    // const addField = (fieldName, description, type, resolve, spec, hint) => {
    //   // Field
    //   newFields = extend(
    //     newFields,
    //     {
    //       [fieldName]: fieldWithHooks(
    //         fieldName,
    //         {
    //           description,
    //           type,
    //         },
    //         {
    //           isPgConnectionFilterField: true,
    //         },
    //       ),
    //     },
    //     hint,
    //   );
    //   // Spec for use in resolver
    //   forwardPolyRelationSpecByFieldName = extend(forwardPolyRelationSpecByFieldName, {
    //     [fieldName]: spec,
    //   });
    //   // Resolver
    //   connectionFilterRegisterResolver(Self.name, fieldName, resolve);
    // };

    for (const spec of forwardPolyRelationSpecs) {
      const { foreignTable, fieldName } = spec;

      const foreignTableTypeName = inflection.tableType(foreignTable);
      const foreignTableFilterTypeName = inflection.filterType(foreignTableTypeName);
      const ForeignTableFilterType = connectionFilterType(
        newWithHooks,
        foreignTableFilterTypeName,
        foreignTable,
        foreignTableTypeName,
      );
      if (!ForeignTableFilterType) continue;

      newFields = addField(
        fieldName,
        `Filter by the object’s \`${fieldName}\` polymorphic relation.`,
        ForeignTableFilterType,
        resolve,
        spec,
        `Adding connection filter forward polymorphic relation field from ${describePgEntity(
          table,
        )} to ${describePgEntity(foreignTable)}`,
        build,
        newFields,
        forwardPolyRelationSpecByFieldName,
        Self
      );
    }

    function resolve({ sourceAlias, fieldName, fieldValue, queryBuilder }) {
      if (fieldValue == null) return null;

      const {
        foreignTable,
        foreignPrimaryKey,
        constraint,
      } = forwardPolyRelationSpecByFieldName[fieldName];

      const foreignTableTypeName = inflection.tableType(foreignTable);
      const foreignTableAlias = sql.identifier(Symbol());
      const sourceTableId = `${constraint.name}_id`;
      const sourceTableType = `${constraint.name}_type`;

      const sqlIdentifier = sql.identifier(foreignTable.namespace.name, foreignTable.name);
      // sql match query
      // sql string "(table_alias).xxx_type = 'User' and (table alias).xxx_id = (users alias).id"
      const sqlKeysMatch = sql.query`(${sql.fragment`${sourceAlias}.${sql.identifier(
        sourceTableId,
      )} = ${foreignTableAlias}.${sql.identifier(foreignPrimaryKey.name)}`}) and (
        ${sql.fragment`${sourceAlias}.${sql.identifier(
        sourceTableType,
      )} = ${sql.value(foreignTableTypeName)}`})`;

      const foreignTableFilterTypeName = inflection.filterType(foreignTableTypeName);

      const sqlFragment = connectionFilterResolve(
        fieldValue,
        foreignTableAlias,
        foreignTableFilterTypeName,
        queryBuilder,
      );

      return sqlFragment == null
        ? null
        : sql.query`\
      exists(
        select 1 from ${sqlIdentifier} as ${foreignTableAlias}
        where ${sqlKeysMatch} and
          (${sqlFragment})
      )`;
    }

    return newFields;
  });
};
