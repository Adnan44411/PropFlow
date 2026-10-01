import { DataTypes, QueryInterface } from 'sequelize';
import type { MigrationFn } from 'umzug';

export const up: MigrationFn<QueryInterface> = async ({ context: qi }) => {
  // ============================================================
  // Rename legacy camelCase timestamps -> snake_case
  // ============================================================
  for (const table of [
    'property_statuses',
    'property_types',
    'localities',
    'amenities',
    'properties',
    'property_amenities',
  ]) {
    const columns = await qi.describeTable(table);

    if (columns.createdAt && !columns.created_at) {
      await qi.renameColumn(table, 'createdAt', 'created_at');
    }

    if (columns.updatedAt && !columns.updated_at) {
      await qi.renameColumn(table, 'updatedAt', 'updated_at');
    }
  }

  // ============================================================
  // property_statuses
  // ============================================================
  const statusColumns = await qi.describeTable('property_statuses');

  if (statusColumns.created_at) {
    await qi.changeColumn('property_statuses', 'created_at', {
      type: DataTypes.DATE,
      allowNull: false,
    });
  }

  if (statusColumns.updated_at) {
    await qi.changeColumn('property_statuses', 'updated_at', {
      type: DataTypes.DATE,
      allowNull: false,
    });
  }

  // ============================================================
  // property_types
  // ============================================================
  const typeColumns = await qi.describeTable('property_types');

  if (typeColumns.created_at) {
    await qi.changeColumn('property_types', 'created_at', {
      type: DataTypes.DATE,
      allowNull: false,
    });
  }

  if (typeColumns.updated_at) {
    await qi.changeColumn('property_types', 'updated_at', {
      type: DataTypes.DATE,
      allowNull: false,
    });
  }

  // ============================================================
  // localities
  // ============================================================
  const localityColumns = await qi.describeTable('localities');

  if (localityColumns.created_at) {
    await qi.changeColumn('localities', 'created_at', {
      type: DataTypes.DATE,
      allowNull: false,
    });
  }

  if (localityColumns.updated_at) {
    await qi.changeColumn('localities', 'updated_at', {
      type: DataTypes.DATE,
      allowNull: false,
    });
  }

  // ============================================================
  // amenities
  // ============================================================
  const amenityColumns = await qi.describeTable('amenities');

  if (amenityColumns.created_at) {
    await qi.changeColumn('amenities', 'created_at', {
      type: DataTypes.DATE,
      allowNull: false,
    });
  }

  if (amenityColumns.updated_at) {
    await qi.changeColumn('amenities', 'updated_at', {
      type: DataTypes.DATE,
      allowNull: false,
    });
  }

  // ============================================================
  // properties
  // ============================================================
  const propertyColumns = await qi.describeTable('properties');

  if (propertyColumns.created_at) {
    await qi.changeColumn('properties', 'created_at', {
      type: DataTypes.DATE,
      allowNull: false,
    });
  }

  if (propertyColumns.updated_at) {
    await qi.changeColumn('properties', 'updated_at', {
      type: DataTypes.DATE,
      allowNull: false,
    });
  }

  // Seed uses SALE / RENT.
  await qi.sequelize.query(`
    ALTER TABLE properties
    MODIFY COLUMN listing_type ENUM('SALE','RENT') NOT NULL
  `);

  // Seed does not insert the legacy JSON amenities column.
  // property_amenities is the normalized source now.
  await qi.changeColumn('properties', 'amenities', {
    type: DataTypes.JSON,
    allowNull: true,
  });

  // ============================================================
  // property_amenities
  // ============================================================
  const propertyAmenityColumns = await qi.describeTable('property_amenities');

  if (propertyAmenityColumns.created_at) {
    await qi.sequelize.query(`
      ALTER TABLE property_amenities
      MODIFY COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    `);
  }

  if (propertyAmenityColumns.updated_at) {
    await qi.sequelize.query(`
      ALTER TABLE property_amenities
      MODIFY COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    `);
  }

  // ============================================================
  // property_activity
  // ============================================================
  const activityColumns = await qi.describeTable('property_activity');

  if (activityColumns.actor_id) {
    await qi.changeColumn('property_activity', 'actor_id', {
      type: DataTypes.INTEGER,
      allowNull: true,
    });
  }

  // ============================================================
  // property_notes
  // ============================================================
  const noteColumns = await qi.describeTable('property_notes');

  if (noteColumns.property_id) {
    await qi.changeColumn('property_notes', 'property_id', {
      type: DataTypes.BIGINT,
      allowNull: false,
    });
  }

  // ============================================================
  // chat_messages
  // ============================================================
  const chatColumns = await qi.describeTable('chat_messages');

  if (chatColumns.property_id) {
    await qi.changeColumn('chat_messages', 'property_id', {
      type: DataTypes.BIGINT,
      allowNull: false,
    });
  }

  // ============================================================
  // site_visits
  // ============================================================
  const visitColumns = await qi.describeTable('site_visits');

  if (visitColumns.visitor_phone) {
    await qi.changeColumn('site_visits', 'visitor_phone', {
      type: DataTypes.STRING(30),
      allowNull: true,
    });
  }

  if (visitColumns.scheduled_at) {
    await qi.changeColumn('site_visits', 'scheduled_at', {
      type: DataTypes.DATE,
      allowNull: true,
    });
  }
};

export const down: MigrationFn<QueryInterface> = async () => {
  // Intentionally non-destructive.
};
