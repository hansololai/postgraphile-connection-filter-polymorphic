import { SchemaBuilder } from 'postgraphile';
interface SimplePgTableIntrospect {
  name: string;
  id: string;
  attributesMap: AttributesMap;
}
interface AttributesMap {
  [x: string]: PgAttribute;
}
export type FieldToDBMap = {
  [x: string]: SimplePgTableIntrospect;
};
interface PgAttribute {
  name: any;
}

export const addModelTableMappingPlugin = (builder: SchemaBuilder) => {
  builder.hook('build', (build) => {
    const {
      pgSql: sql,
      pgIntrospectionResultsByKind: { procedure, class: pgClasses },
      inflection: { upperCamelCase, singularize, camelCase },
    } = build;

    const fieldToDBMap: FieldToDBMap = pgClasses.reduce((acc, cur) => {
      if (cur.namespaceName === 'pg_catalog' || cur.namespaceName === 'information_schema') {
        // skipt it
        return acc;
      }
      const procedureAttriutesMap: AttributesMap = procedure.filter(p => p.name.startsWith(`${cur.name}_`))
        .reduce((a, c) => {
          const k = singularize(camelCase(c.name.replace(`${cur.name}_`, '')));
          a[k] = c;
          return a;
        }, {});
      // The Model Name points to this pg object
      const curTable: SimplePgTableIntrospect = {
        name: cur.name,
        id: cur.id,
        attributesMap: cur.attributes.reduce((allAtt: AttributesMap, curA: PgAttribute) => {
          allAtt[singularize(camelCase(curA.name))] = curA;
          return allAtt;
        }, procedureAttriutesMap),
      };
      acc[singularize(upperCamelCase(cur.name))] = curTable;
      return acc;
    }, {});
    return build.extend(build, { mapFieldToPgTable: fieldToDBMap });
  });
};
