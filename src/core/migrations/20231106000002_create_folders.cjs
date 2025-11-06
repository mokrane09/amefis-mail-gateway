exports.up = function(knex) {
  return knex.schema.createTable('folders', table => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('session_id').notNullable()
      .references('id').inTable('sessions').onDelete('CASCADE');
    table.text('name').notNullable();
    table.text('path').notNullable();
    table.text('special_use');
    table.integer('uid_validity').notNullable();
    table.bigInteger('highest_modseq');
    table.integer('uid_next');
    
    table.unique(['session_id', 'path']);
    table.index('session_id');
    table.index('special_use');
  });
};

exports.down = function(knex) {
  return knex.schema.dropTableIfExists('folders');
};

