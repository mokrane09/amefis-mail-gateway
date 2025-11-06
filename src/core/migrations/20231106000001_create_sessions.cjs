exports.up = function(knex) {
  return knex.schema.createTable('sessions', table => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.text('email').notNullable();
    table.text('host').notNullable();
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('last_seen_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('expires_at', { useTz: true }).notNullable();
    
    table.index('email');
    table.index('expires_at');
  });
};

exports.down = function(knex) {
  return knex.schema.dropTableIfExists('sessions');
};

