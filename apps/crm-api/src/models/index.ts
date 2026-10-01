import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model, NonAttribute } from 'sequelize';
import type { Furnishing, ListingType, Role, StatusStage } from '@propflow/shared';
import { sequelize } from '../lib/db';

// ───────────── Identity mirrors (source of truth: auth-server) ─────────────

export class TenantMirror extends Model<InferAttributes<TenantMirror>, InferCreationAttributes<TenantMirror>> {
  declare id: number;
  declare name: string;
  declare slug: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
TenantMirror.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true },
    name: { type: DataTypes.STRING(120), allowNull: false },
    slug: { type: DataTypes.STRING(60), allowNull: true },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: 'tenants', modelName: 'TenantMirror' },
);

export class UserMirror extends Model<InferAttributes<UserMirror>, InferCreationAttributes<UserMirror>> {
  declare id: number;
  declare tenantId: number | null;
  declare name: string;
  declare email: string | null;
  declare role: Role;
  declare isActive: CreationOptional<boolean>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
UserMirror.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true },
    tenantId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    name: { type: DataTypes.STRING(120), allowNull: false },
    email: { type: DataTypes.STRING(190), allowNull: true },
    role: { type: DataTypes.ENUM('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'AGENT'), allowNull: false },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: 'users', modelName: 'UserMirror' },
);

// ───────────── Master data ─────────────

const masterAttrs = {
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  tenantId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  name: { type: DataTypes.STRING(80), allowNull: false },
  sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  createdAt: DataTypes.DATE,
  updatedAt: DataTypes.DATE,
};

export class PropertyStatus extends Model<InferAttributes<PropertyStatus>, InferCreationAttributes<PropertyStatus>> {
  declare id: CreationOptional<number>;
  declare tenantId: number;
  declare key: string | null;
  declare name: string;
  declare stage: StatusStage;
  declare sortOrder: CreationOptional<number>;
  declare isActive: CreationOptional<boolean>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
PropertyStatus.init(
  {
    ...masterAttrs,
    key: { type: DataTypes.STRING(40), allowNull: true },
    stage: { type: DataTypes.ENUM('OPEN', 'WON', 'LOST'), allowNull: false, defaultValue: 'OPEN' },
  },
  { sequelize, tableName: 'property_statuses', modelName: 'PropertyStatus' },
);

export class PropertyType extends Model<InferAttributes<PropertyType>, InferCreationAttributes<PropertyType>> {
  declare id: CreationOptional<number>;
  declare tenantId: number;
  declare name: string;
  declare sortOrder: CreationOptional<number>;
  declare isActive: CreationOptional<boolean>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
PropertyType.init(masterAttrs, { sequelize, tableName: 'property_types', modelName: 'PropertyType' });

export class Locality extends Model<InferAttributes<Locality>, InferCreationAttributes<Locality>> {
  declare id: CreationOptional<number>;
  declare tenantId: number;
  declare name: string;
  declare city: string;
  declare sortOrder: CreationOptional<number>;
  declare isActive: CreationOptional<boolean>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
Locality.init({ ...masterAttrs, city: { type: DataTypes.STRING(80), allowNull: false } }, { sequelize, tableName: 'localities', modelName: 'Locality' });

export class Amenity extends Model<InferAttributes<Amenity>, InferCreationAttributes<Amenity>> {
  declare id: CreationOptional<number>;
  declare tenantId: number;
  declare name: string;
  declare sortOrder: CreationOptional<number>;
  declare isActive: CreationOptional<boolean>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
Amenity.init(masterAttrs, { sequelize, tableName: 'amenities', modelName: 'Amenity' });

// ───────────── Properties ─────────────

export class Property extends Model<InferAttributes<Property>, InferCreationAttributes<Property>> {
  declare id: CreationOptional<number>;
  declare tenantId: number;
  declare title: string;
  declare typeId: number;
  declare statusId: number;
  declare listingType: ListingType;
  declare bhk: number;
  declare furnishing: CreationOptional<Furnishing>;
  declare carpetAreaSqft: number;
  declare priceInr: number;
  declare listedPriceInr: number;
  declare buildingName: string;
  declare unitNo: string;
  declare floor: number | null;
  declare totalFloors: number | null;
  declare localityId: number;
  declare city: string;
  declare address: string | null;
  declare ownerName: string;
  declare ownerPhone: string;
  declare assigneeId: number | null;
  declare createdBy: number | null;
  declare isStale: CreationOptional<boolean>;
  declare lastActivityAt: Date;
  declare closedAt: CreationOptional<Date | null>;
  declare version: CreationOptional<number>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
  declare deletedAt: CreationOptional<Date | null>;
  declare amenities?: NonAttribute<Amenity[]>;
}
Property.init(
  {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    tenantId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    title: { type: DataTypes.STRING(200), allowNull: false },
    typeId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    statusId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    listingType: { type: DataTypes.ENUM('SALE', 'RENT'), allowNull: false },
    bhk: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false },
    furnishing: { type: DataTypes.ENUM('UNFURNISHED', 'SEMI_FURNISHED', 'FULLY_FURNISHED'), allowNull: false, defaultValue: 'UNFURNISHED' },
    carpetAreaSqft: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    priceInr: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    listedPriceInr: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    buildingName: { type: DataTypes.STRING(150), allowNull: false },
    unitNo: { type: DataTypes.STRING(40), allowNull: false },
    floor: { type: DataTypes.SMALLINT, allowNull: true },
    totalFloors: { type: DataTypes.SMALLINT, allowNull: true },
    localityId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    city: { type: DataTypes.STRING(80), allowNull: false },
    address: { type: DataTypes.STRING(500), allowNull: true },
    ownerName: { type: DataTypes.STRING(120), allowNull: false },
    ownerPhone: { type: DataTypes.STRING(20), allowNull: false },
    assigneeId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    createdBy: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    isStale: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    lastActivityAt: { type: DataTypes.DATE, allowNull: false },
    closedAt: { type: DataTypes.DATE, allowNull: true },
    version: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1 },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
    deletedAt: DataTypes.DATE,
  },
  { sequelize, tableName: 'properties', modelName: 'Property', paranoid: true },
);

export class PropertyAmenity extends Model<InferAttributes<PropertyAmenity>, InferCreationAttributes<PropertyAmenity>> {
  declare propertyId: number;
  declare amenityId: number;
}
PropertyAmenity.init(
  {
    propertyId: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true },
    amenityId: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true },
  },
  { sequelize, tableName: 'property_amenities', modelName: 'PropertyAmenity', timestamps: false },
);

export class PropertyNote extends Model<InferAttributes<PropertyNote>, InferCreationAttributes<PropertyNote>> {
  declare id: CreationOptional<number>;
  declare tenantId: number;
  declare propertyId: number;
  declare authorId: number;
  declare body: string;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
PropertyNote.init(
  {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    tenantId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    propertyId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    authorId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    body: { type: DataTypes.TEXT, allowNull: false },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: 'property_notes', modelName: 'PropertyNote' },
);

export class PropertyActivity extends Model<InferAttributes<PropertyActivity>, InferCreationAttributes<PropertyActivity>> {
  declare id: CreationOptional<number>;
  declare tenantId: number;
  declare propertyId: number;
  declare actorId: number | null;
  declare action: 'CREATED' | 'UPDATED' | 'DELETED' | 'BULK_REASSIGN' | 'BULK_STATUS' | 'BULK_AMENITY' | 'MARKED_STALE';
  declare summary: string | null;
  declare diff: Record<string, { from: unknown; to: unknown; fromLabel?: string | null; toLabel?: string | null }> | null;
  declare requestId: string | null;
  declare createdAt: CreationOptional<Date>;
}
PropertyActivity.init(
  {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    tenantId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    propertyId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    actorId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    action: { type: DataTypes.STRING(30), allowNull: false },
    summary: { type: DataTypes.STRING(500), allowNull: true },
    diff: { type: DataTypes.JSON, allowNull: true },
    requestId: { type: DataTypes.STRING(64), allowNull: true },
    createdAt: DataTypes.DATE,
  },
  { sequelize, tableName: 'property_activity', modelName: 'PropertyActivity', updatedAt: false },
);

export class SiteVisit extends Model<InferAttributes<SiteVisit>, InferCreationAttributes<SiteVisit>> {
  declare id: CreationOptional<number>;
  declare tenantId: number;
  declare propertyId: number;
  declare agentId: number;
  declare visitAtUtc: Date;
  declare durationMinutes: CreationOptional<number>;
  declare visitorName: string | null;
  declare visitorPhone: string | null;
  declare notes: string | null;
  declare outcome: CreationOptional<'SCHEDULED' | 'COMPLETED' | 'NO_SHOW' | 'CANCELLED' | 'INTERESTED' | 'NOT_INTERESTED'>;
  declare remindedAt: CreationOptional<Date | null>;
  declare createdBy: number | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
  declare property?: NonAttribute<Property>;
}
SiteVisit.init(
  {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    tenantId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    propertyId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    agentId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    visitAtUtc: { type: DataTypes.DATE, allowNull: false, field: 'visit_at_utc' },
    durationMinutes: { type: DataTypes.SMALLINT.UNSIGNED, allowNull: false, defaultValue: 60 },
    visitorName: { type: DataTypes.STRING(120), allowNull: true },
    visitorPhone: { type: DataTypes.STRING(20), allowNull: true },
    notes: { type: DataTypes.STRING(2000), allowNull: true },
    outcome: {
      type: DataTypes.ENUM('SCHEDULED', 'COMPLETED', 'NO_SHOW', 'CANCELLED', 'INTERESTED', 'NOT_INTERESTED'),
      allowNull: false,
      defaultValue: 'SCHEDULED',
    },
    remindedAt: { type: DataTypes.DATE, allowNull: true },
    createdBy: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: 'site_visits', modelName: 'SiteVisit' },
);

export class ChatMessage extends Model<InferAttributes<ChatMessage>, InferCreationAttributes<ChatMessage>> {
  declare id: CreationOptional<number>;
  declare tenantId: number;
  declare propertyId: number;
  declare senderId: number;
  declare clientMsgId: string;
  declare body: string;
  declare createdAt: CreationOptional<Date>;
}
ChatMessage.init(
  {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    tenantId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    propertyId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    senderId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    clientMsgId: { type: DataTypes.STRING(64), allowNull: false },
    body: { type: DataTypes.TEXT, allowNull: false },
    createdAt: DataTypes.DATE,
  },
  { sequelize, tableName: 'chat_messages', modelName: 'ChatMessage', updatedAt: false },
);

Property.belongsToMany(Amenity, { through: PropertyAmenity, foreignKey: 'propertyId', otherKey: 'amenityId', as: 'amenities' });
SiteVisit.belongsTo(Property, { foreignKey: 'propertyId', as: 'property' });

export { sequelize };
