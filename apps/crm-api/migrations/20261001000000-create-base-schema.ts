import { DataTypes, QueryInterface } from 'sequelize';
import type { MigrationFn } from 'umzug';

export const up: MigrationFn<QueryInterface> = async ({ context: qi }) => {
  await qi.createTable('tenants', {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING(120), allowNull: false },
    slug: { type: DataTypes.STRING(60), allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });

  await qi.createTable('users', {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true },
    tenant_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    name: { type: DataTypes.STRING(120), allowNull: false },
    email: { type: DataTypes.STRING(190), allowNull: true },
    role: {
      type: DataTypes.ENUM('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'AGENT'),
      allowNull: false,
    },
    is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });

  await qi.createTable('property_statuses', {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    tenant_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    name: { type: DataTypes.STRING(80), allowNull: false },
    sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });

  await qi.createTable('property_types', {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    tenant_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    name: { type: DataTypes.STRING(80), allowNull: false },
    sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });

  await qi.createTable('localities', {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    tenant_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    name: { type: DataTypes.STRING(80), allowNull: false },
    city: { type: DataTypes.STRING(80), allowNull: false },
    sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });

  await qi.createTable('amenities', {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    tenant_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    name: { type: DataTypes.STRING(80), allowNull: false },
    sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });

  await qi.createTable('properties', {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    tenant_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    title: { type: DataTypes.STRING(200), allowNull: false },
    type_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    status_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    listing_type: { type: DataTypes.ENUM('SALE', 'RENT'), allowNull: false },
    bhk: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false },
    furnishing: {
      type: DataTypes.ENUM('UNFURNISHED', 'SEMI_FURNISHED', 'FULLY_FURNISHED'),
      allowNull: false,
      defaultValue: 'UNFURNISHED',
    },
    carpet_area_sqft: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    price_inr: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    listed_price_inr: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    building_name: { type: DataTypes.STRING(150), allowNull: false },
    unit_no: { type: DataTypes.STRING(40), allowNull: false },
    floor: { type: DataTypes.SMALLINT, allowNull: true },
    total_floors: { type: DataTypes.SMALLINT, allowNull: true },
    locality_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    city: { type: DataTypes.STRING(80), allowNull: false },
    address: { type: DataTypes.STRING(500), allowNull: true },
    owner_name: { type: DataTypes.STRING(120), allowNull: false },
    owner_phone: { type: DataTypes.STRING(20), allowNull: false },
    assignee_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    created_by: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    is_stale: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    last_activity_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    closed_at: { type: DataTypes.DATE, allowNull: true },
    version: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1 },
    amenities: { type: DataTypes.JSON, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    deleted_at: { type: DataTypes.DATE, allowNull: true },
  });

  await qi.createTable('property_amenities', {
    property_id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true },
    amenity_id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });

  await qi.createTable('property_activity', {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    tenant_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    property_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    actor_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    action: { type: DataTypes.STRING(30), allowNull: false },
    summary: { type: DataTypes.STRING(500), allowNull: true },
    diff: { type: DataTypes.JSON, allowNull: true },
    request_id: { type: DataTypes.STRING(64), allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });

  await qi.createTable('site_visits', {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    tenant_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    property_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    created_by: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    scheduled_at: { type: DataTypes.DATE, allowNull: true },
    status: {
      type: DataTypes.STRING(30),
      allowNull: false,
      defaultValue: 'scheduled',
    },
    visitor_name: { type: DataTypes.STRING(120), allowNull: true },
    visitor_phone: { type: DataTypes.STRING(30), allowNull: true },
    notes: { type: DataTypes.STRING(2000), allowNull: true },
    agent_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    visit_at_utc: { type: DataTypes.DATE, allowNull: true },
    duration_minutes: { type: DataTypes.SMALLINT.UNSIGNED, allowNull: false, defaultValue: 60 },
    outcome: { type: DataTypes.STRING(30), allowNull: true },
    reminded_at: { type: DataTypes.DATE, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });

  await qi.addConstraint('users', {
    fields: ['tenant_id'],
    type: 'foreign key',
    references: { table: 'tenants', field: 'id' },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
  });

  await qi.addConstraint('property_statuses', {
    fields: ['tenant_id'],
    type: 'foreign key',
    references: { table: 'tenants', field: 'id' },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
  });

  await qi.addConstraint('property_types', {
    fields: ['tenant_id'],
    type: 'foreign key',
    references: { table: 'tenants', field: 'id' },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
  });

  await qi.addConstraint('localities', {
    fields: ['tenant_id'],
    type: 'foreign key',
    references: { table: 'tenants', field: 'id' },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
  });

  await qi.addConstraint('amenities', {
    fields: ['tenant_id'],
    type: 'foreign key',
    references: { table: 'tenants', field: 'id' },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
  });

  await qi.addConstraint('properties', {
    fields: ['tenant_id'],
    type: 'foreign key',
    references: { table: 'tenants', field: 'id' },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
  });

  await qi.addConstraint('properties', {
    fields: ['type_id'],
    type: 'foreign key',
    references: { table: 'property_types', field: 'id' },
    onUpdate: 'CASCADE',
    onDelete: 'RESTRICT',
  });

  await qi.addConstraint('properties', {
    fields: ['status_id'],
    type: 'foreign key',
    references: { table: 'property_statuses', field: 'id' },
    onUpdate: 'CASCADE',
    onDelete: 'RESTRICT',
  });

  await qi.addConstraint('properties', {
    fields: ['locality_id'],
    type: 'foreign key',
    references: { table: 'localities', field: 'id' },
    onUpdate: 'CASCADE',
    onDelete: 'RESTRICT',
  });

  await qi.addConstraint('property_amenities', {
    fields: ['property_id'],
    type: 'foreign key',
    references: { table: 'properties', field: 'id' },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
  });

  await qi.addConstraint('property_amenities', {
    fields: ['amenity_id'],
    type: 'foreign key',
    references: { table: 'amenities', field: 'id' },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
  });

  await qi.addConstraint('property_activity', {
    fields: ['property_id'],
    type: 'foreign key',
    references: { table: 'properties', field: 'id' },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
  });

  await qi.addConstraint('site_visits', {
    fields: ['property_id'],
    type: 'foreign key',
    references: { table: 'properties', field: 'id' },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
  });
};

export const down: MigrationFn<QueryInterface> = async ({ context: qi }) => {
  for (const table of [
    'site_visits',
    'property_activity',
    'property_amenities',
    'properties',
    'amenities',
    'localities',
    'property_types',
    'property_statuses',
    'users',
    'tenants',
  ]) {
    await qi.dropTable(table);
  }
};
