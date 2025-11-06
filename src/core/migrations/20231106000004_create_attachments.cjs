exports.up = function(knex) {
  return knex.schema.createTable('attachments', table => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('session_id').notNullable()
      .references('id').inTable('sessions').onDelete('CASCADE');
    table.uuid('message_id').notNullable()
      .references('id').inTable('messages').onDelete('CASCADE');
    table.text('filename').notNullable();
    table.text('mime_type').notNullable();
    table.integer('size').notNullable();
    table.text('path').notNullable();
    table.boolean('is_inline').defaultTo(false);
    table.text('cid');
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    
    table.index('cid');
    table.index('message_id');
  });
};

exports.down = function(knex) {
  return knex.schema.dropTableIfExists('attachments');
};

