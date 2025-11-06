exports.up = async function(knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS pg_trgm');
  
  await knex.schema.createTable('messages', table => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('session_id').notNullable()
      .references('id').inTable('sessions').onDelete('CASCADE');
    table.uuid('folder_id').notNullable()
      .references('id').inTable('folders').onDelete('CASCADE');
    table.integer('uid').notNullable();
    table.text('msg_id');
    table.text('thread_key');
    table.text('subject');
    table.timestamp('date', { useTz: true });
    table.text('from_name');
    table.text('from_email');
    table.text('to_list');
    table.text('cc_list');
    table.text('bcc_list');
    table.boolean('seen').defaultTo(false);
    table.boolean('flagged').defaultTo(false);
    table.boolean('answered').defaultTo(false);
    table.boolean('draft').defaultTo(false);
    table.boolean('deleted').defaultTo(false);
    table.text('keywords');
    table.boolean('has_html').defaultTo(false);
    table.boolean('has_text').defaultTo(false);
    table.text('snippet');
    table.integer('size');
    table.boolean('has_attachments').defaultTo(false);
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    
    table.unique(['folder_id', 'uid']);
    table.index(['session_id', 'thread_key']);
    table.index('from_email');
  });
  
  // Add generated tsvector column for subject
  await knex.raw(`
    ALTER TABLE messages 
    ADD COLUMN subject_tsv tsvector 
    GENERATED ALWAYS AS (to_tsvector('simple', coalesce(subject, ''))) STORED
  `);
  
  // Add body_tsv column (not generated, populated by application)
  await knex.raw(`
    ALTER TABLE messages 
    ADD COLUMN body_tsv tsvector
  `);
  
  // Create GIN indexes
  await knex.raw('CREATE INDEX messages_subject_tsv_idx ON messages USING GIN (subject_tsv)');
  await knex.raw('CREATE INDEX messages_body_tsv_idx ON messages USING GIN (body_tsv)');
  await knex.raw('CREATE INDEX messages_subject_trgm_idx ON messages USING GIN (subject gin_trgm_ops)');
  await knex.raw('CREATE INDEX messages_from_email_trgm_idx ON messages USING GIN (from_email gin_trgm_ops)');
};

exports.down = function(knex) {
  return knex.schema.dropTableIfExists('messages');
};

