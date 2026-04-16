
const mongoose = require('mongoose');
const Order = require('./backend/src/modules/order/Order.js').default || require('./backend/src/modules/order/Order.js');

async function checkOrder() {
  try {
    await mongoose.connect('mongodb://localhost:27017/smart-mobile-store'); // Assuming local mongo
    const order = await mongoose.model('Order').findOne({ orderNumber: 'ORD-20260416-329639176' });
    if (!order) {
      console.log('Order not found');
    } else {
      console.log('Order Details:');
      console.log('ID:', order._id);
      console.log('OrderNumber:', order.orderNumber);
      console.log('Source:', order.orderSource);
      console.log('Status:', order.status);
      console.log('PaymentStatus:', order.paymentStatus);
      console.log('FulfillmentType:', order.fulfillmentType);
      console.log('AssignedStore:', order.assignedStore);
    }
  } catch (err) {
    console.error(err);
  } finally {
    await mongoose.disconnect();
  }
}

checkOrder();
