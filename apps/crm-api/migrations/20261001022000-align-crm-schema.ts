import type { MigrationFn } from 'umzug';
import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

export const up: MigrationFn<QueryInterface> = async ({ context: qi }) => {
  // ------------------------------------------------------------
  // property_statuses
  // ------------------------------------------------------------
  const statusColumns = await qi.describeTable('property_statuses');

  if (!statusColumns.key) {
    await qi.addColumn('property_statuses', 'key', {
      type: DataTypes.STRING(50),
      allowNull: true,
    });
  }

  if (!statusColumns.stage) {
    await qi.addColumn('property_statuses', 'stage', {
      type: DataTypes.STRING(20),
      allowNull: true,
    });
  }

  // Existing rows need valid values before making columns required.
  await qi.sequelize.query(`
    UPDATE property_statuses
    SET
      \`key\` = CASE
        WHEN LOWER(name) = 'draft' THEN 'draft'
        WHEN LOWER(name) = 'listed' THEN 'listed'
        WHEN LOWER(name) = 'site visit' THEN 'site_visit'
        WHEN LOWER(name) = 'negotiation' THEN 'negotiation'
        WHEN LOWER(name) = 'closed' THEN 'closed'
        WHEN LOWER(name) = 'withdrawn' THEN 'withdrawn'
        ELSE LOWER(REPLACE(name, ' ', '_'))
      END,
      stage = CASE
        WHEN LOWER(name) = 'closed' THEN 'WON'
        WHEN LOWER(name) = 'withdrawn' THEN 'LOST'
        ELSE 'OPEN'
      END
    WHERE \`key\` IS NULL OR stage IS NULL
  `);

  await qi.changeColumn('property_statuses', 'key', {
    type: DataTypes.STRING(50),
    allowNull: false,
  });

  await qi.changeColumn('property_statuses', 'stage', {
    type: DataTypes.STRING(20),
    allowNull: false,
  });

  // ------------------------------------------------------------
  // localities
  // ------------------------------------------------------------
  const localityColumns = await qi.describeTable('localities');

  if (!localityColumns.city) {
    await qi.addColumn('localities', 'city', {
      type: DataTypes.STRING(100),
      allowNull: true,
    });
  }

  await qi.sequelize.query(`
    UPDATE localities
    SET city = COALESCE(city, 'Unknown')
    WHERE city IS NULL
  `);

  await qi.changeColumn('localities', 'city', {
    type: DataTypes.STRING(100),
    allowNull: false,
  });

  // ------------------------------------------------------------
  // properties
  // ------------------------------------------------------------
  const propertyColumns = await qi.describeTable('properties');

  if (!propertyColumns.furnishing) {
    await qi.addColumn('properties', 'furnishing', {
      type: DataTypes.STRING(30),
      allowNull: true,
    });
  }

  if (!propertyColumns.listed_price_inr) {
    await qi.addColumn('properties', 'listed_price_inr', {
      type: DataTypes.BIGINT,
      allowNull: true,
    });
  }

  if (!propertyColumns.floor) {
    await qi.addColumn('properties', 'floor', {
      type: DataTypes.INTEGER,
      allowNull: true,
    });
  }

  if (!propertyColumns.total_floors) {
    await qi.addColumn('properties', 'total_floors', {
      type: DataTypes.INTEGER,
      allowNull: true,
    });
  }

  if (!propertyColumns.city) {
    await qi.addColumn('properties', 'city', {
      type: DataTypes.STRING(100),
      allowNull: true,
    });
  }

  if (!propertyColumns.address) {
    await qi.addColumn('properties', 'address', {
      type: DataTypes.STRING(500),
      allowNull: true,
    });
  }

  if (!propertyColumns.created_by) {
    await qi.addColumn('properties', 'created_by', {
      type: DataTypes.INTEGER,
      allowNull: true,
    });
  }

  if (!propertyColumns.closed_at) {
    await qi.addColumn('properties', 'closed_at', {
      type: DataTypes.DATE,
      allowNull: true,
    });
  }

  // Backfill listed price from current price.
  await qi.sequelize.query(`
    UPDATE properties
    SET listed_price_inr = price_inr
    WHERE listed_price_inr IS NULL
  `);

  // Backfill city/address from locality/title where possible.
  await qi.sequelize.query(`
    UPDATE properties p
    LEFT JOIN localities l ON l.id = p.locality_id
    SET
      p.city = COALESCE(p.city, l.city, 'Unknown'),
      p.address = COALESCE(p.address, p.title)
    WHERE p.city IS NULL OR p.address IS NULL
  `);

  // ------------------------------------------------------------
  // property_activity
  // ------------------------------------------------------------
  const activityColumns = await qi.describeTable('property_activity');

  if (activityColumns.user_id && !activityColumns.actor_id) {
    await qi.renameColumn(
      'property_activity',
      'user_id',
      'actor_id',
    );
  }

  const activityColumnsAfterRename =
    await qi.describeTable('property_activity');

  if (!activityColumnsAfterRename.summary) {
    await qi.addColumn('property_activity', 'summary', {
      type: DataTypes.STRING(255),
      allowNull: true,
    });
  }

  if (!activityColumnsAfterRename.diff) {
    await qi.addColumn('property_activity', 'diff', {
      type: DataTypes.JSON,
      allowNull: true,
    });
  }

  if (!activityColumnsAfterRename.request_id) {
    await qi.addColumn('property_activity', 'request_id', {
      type: DataTypes.STRING(100),
      allowNull: true,
    });
  }

  // The existing action enum is older than the current application.
  await qi.sequelize.query(`
    ALTER TABLE property_activity
    MODIFY COLUMN action ENUM(
      'CREATE',
      'UPDATE',
      'DELETE',
      'BULK_UPDATE',
      'BULK_REASSIGN',
      'CREATED',
      'UPDATED'
    ) NOT NULL
  `);

  // ------------------------------------------------------------
  // chat_messages
  // ------------------------------------------------------------
  const chatColumns = await qi.describeTable('chat_messages');

  if (chatColumns.message && !chatColumns.body) {
    await qi.renameColumn(
      'chat_messages',
      'message',
      'body',
    );
  }

  // ------------------------------------------------------------
  // property_notes
  // ------------------------------------------------------------
  const noteColumns = await qi.describeTable('property_notes');

  if (noteColumns.property_id) {
    // Keep existing table; no destructive changes.
  }
};

export const down: MigrationFn<QueryInterface> = async ({ context: qi }) => {
  // This migration is intentionally non-destructive.
  // Existing production/assignment data should not be removed automatically.
};
