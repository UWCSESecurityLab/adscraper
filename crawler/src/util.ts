import {Page} from "puppeteer";
import pkg from 'puppeteer-autoscroll-down';
const { scrollPageToBottom, scrollPageToTop } = pkg;

export const delay = (time: number) => {
    return new Promise(function (resolve) {
        setTimeout(resolve, time)
    });
}

// @ts-ignore
export const scrollTowardsBottom = async (page: Page) => await scrollPageToBottom(page, {
    size: 500,
    delay: 50
})

// @ts-ignore
export const scrollTowardsTop = async (page: Page) => await scrollPageToTop(page, {
    size: 500,
    delay: 50
})
