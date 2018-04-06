// const environment = process.env.NODE_ENV || 'development'
// const configuration = require('../knexfile')[environment]
// const database = require('knex')(configuration)

const ENV = process.env.ENV || 'development'
const knexConfig = require('../knexfile')
const knex = require('knex')(knexConfig[ENV])

const { shippingRates } = require('./shippingRates')

function caseAmount(num) {
  let number = Math.floor(num / 12) + 1
  if (num % 12 === 0) {
    number -= 1
  }
  return number
}

async function findAddress(rate) {
  const { address1: address } = rate.destination
  const data = {}
  let orderTotal = 0
  await rate.items.map(item => {
    while (item.quantity >= 12) {
      item.quantity = item.quantity - 12
    }
    orderTotal += item.quantity
  })
  return await knex('customers')
    .select()
    .where('address', address)
    .returning('*')
    .then(result => {
      // Checks if an address exists in the system
      if (result.length === 0) {
        data.orderTotal = orderTotal
        data.prePurchasedCases = 0
        data.prePurchasedBottles = 0
        return data
      } else {
        data.prePurchasedCases = caseAmount(result[0].bottles_purchased)
        data.prePurchasedBottles = result[0].bottles_purchased
        return knex('orders')
          .where('customer_id', result[0].id)
          .join('purchased_items', 'orders.id', '=', 'purchased_items.order_id')
          .then(result => {
            result.map(item => {
              orderTotal += item.quantity
            })
            data.orderTotal = orderTotal
            return data
          })
      }
    })
}

function newCustomerOrder(body) {
  const { email, first_name: firstName, last_name: lastName } = body.customer

  const { address1: address } = body.customer.default_address

  // totals the amount of bottles purchased to insert or increment in the db
  let bottlesPurchased = 0
  body.line_items.map(item => {
    while (item.quantity >= 12) {
      item.quantity = item.quantity - 12
    }
    bottlesPurchased += item.quantity
  })

  // finds a custoemr with the address used (may need to replace this)
  return knex('customers')
    .select()
    .where('address', address)
    .then(result => {
      //if the customer doesn'y exist create one
      if (result.length === 0) {
        console.log('new user created')

        return knex('customers')
          .insert({
            first_name: firstName,
            last_name: lastName,
            email,
            address,
            bottles_purchased: bottlesPurchased,
          })
          .returning('id')
          .then(id => {
            // use the id of the customer created to create orders
            return knex('orders')
              .insert({
                customer_id: id[0],
              })
              .returning('id')
          })
          .then(id => {
            //use the id of the orders to create pruchased items
            body.line_items.map(item => {
              while (item.quantity >= 12) {
                item.quantity = item.quantity - 12
              }
              return knex('purchased_items')
                .insert({
                  product_name: item.title,
                  quantity: item.quantity,
                  order_id: id[0],
                })
                .then(() => {
                  return true
                })
            })
            return true
          })
      } else {
        //if the customer does exist, find them and increment the bottlesPurchased
        return knex('customers')
          .select()
          .where('address', address)
          .increment('bottles_purchased', bottlesPurchased)
          .returning('id')
          .then(result => {
            // insert the new order
            return knex('orders')
              .insert({
                customer_id: result[0],
              })
              .returning('id')
              .then(id => {
                // insert the new purchases connected to the order
                body.line_items.map(item => {
                  // console.log(item.title)
                  return knex('purchased_items')
                    .insert({
                      product_name: item.title,
                      quantity: item.quantity,
                      order_id: id[0],
                    })
                    .then(() => {
                      return true
                    })
                })
                return true
              })
          })
      }
    })

  return true
}

function genericShippingInfo(
  rates,
  prePurchasedCases,
  prePurchasedBottles,
  orderTotal,
  province,
) {
  rates.service_code = province
  rates.description = `You have previously paid for the shipping on ${
    prePurchasedCases
  } cases & bought ${prePurchasedBottles} bottles.`
  rates.service_name = `Cellar Direct Tiered Shipping - ${caseAmount(
    orderTotal,
  )} Case Tier - ${orderTotal} Bottles`
}

function shippingCalculator(rates, orderTotal, prePurchasedCases, province) {
  shippingKey = caseAmount(orderTotal)

  let shippingTotal = 0

  for (let index = prePurchasedCases; index < shippingKey; index++) {
    shippingTotal += shippingRates[`${province}`][index]
  }
  rates.total_price = shippingTotal.toString()
}

module.exports = {
  caseAmount,
  findAddress,
  newCustomerOrder,
  genericShippingInfo,
  shippingCalculator,
}