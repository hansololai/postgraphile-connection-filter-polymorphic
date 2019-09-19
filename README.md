
[![Greenkeeper badge](https://badges.greenkeeper.io/hansololai/postgraphile-connection-filter-polymorphic.svg)](https://greenkeeper.io/)
[![CircleCI](https://circleci.com/gh/hansololai/postgraphile-connection-filter-polymorphic.svg?style=svg)](https://circleci.com/gh/hansololai/postgraphile-connection-filter-polymorphic)
<a href="https://codeclimate.com/github/hansololai/postgraphile-connection-filter-polymorphic/maintainability"><img src="https://api.codeclimate.com/v1/badges/ae63e589ca374f8653b1/maintainability" /></a>
<a href="https://codeclimate.com/github/hansololai/postgraphile-connection-filter-polymorphic/test_coverage"><img src="https://api.codeclimate.com/v1/badges/ae63e589ca374f8653b1/test_coverage" /></a>



# PostGraphile Connection Plugin Polymorphic 
This plugin exposes nested filters created by polymorphic associations. 
Polymorphic associations are defined like this [in ruby on rails](https://guides.rubyonrails.org/association_basics.html#polymorphic-associations).

## Usage
Requires postgraphile@4.2+ and the following plugins appended prior to this plugin:
- `postgraphile-plugin-connection-filter@^1.0.0`

## Feature

### Motivation
The connection filter has already come with very nice and comprehensive nested assocation filters. But it does not support polymorphic associations. 
For example, if you have a tag table, that is polymorphic associated with multiple tables. 
```sql
create table taggs(
  id: integer primary_key,
  taggable_type: text,
  taggable_id: integer,
);

create table user(
  id: integer,
  name: text,
);
```
And a record in taggs is 
```
id: 50
taggable_type: 'User'
taggable_id: 1
```
This means the tag(id:50) is connected to User record of id:1. 

If you want to filter the connections like the following:
```graphql
allTaggs(filter:{
  userAsTaggable:{id:1} // This does not exist in regular connection filter
}){
  nodes{
    id
  }
}
```
and hoping to find the tag(id:50). You won't be able to do it because the `userAsTaggable` does not exist. 

### What this plugin does
This plugin will create the forward relationship. (this `userAsTaggable`) field, and also the backward relationship. (the `taggs` field on User Connection, and other connections that is associated). Also if the `taggable_type` and `taggable_id` are has an unique constraint. The backward filter is not a single object filter, instead of a multi-field, which consist of three fields `some`,`every`,`none`. 

### Install
```
yarn add postgraphile-connection-filter-polymorphic
```

### How to use
This plugin uses [smart comments](https://www.graphile.org/postgraphile/smart-comments/) to know the association. Originally I was planning to use a distinct query on the table to find all possible associations, but that took a long time and is not very customizable. The smart comments are  on the `type` field
```
@isPolymorphic
@polymorphicTo User
@polymorphicTo Post
```
Use the previous example, where a tag is associated with User, and Post. 
```sql
comment on column taggs.taggable_type is E'@isPolymorphic\n@polymorphicTo User\n@polymorphicTo Post';
```

The meta information will transfer to a {isPolymorphic:true, polymorphicTo:['User','Post]}.

Note you MUST have at least two entries for @polymorphicTo in the comment. Because otherwise it will be converted as a string, insteady of array. 

## Development

To establish a test environment, create an empty PostgreSQL database and set a `TEST_DATABASE_URL` environment variable with your database connection string.

```bash
createdb graphile_test
export TEST_DATABASE_URL=postgres://localhost:5432/graphile_test
yarn
yarn test
```
