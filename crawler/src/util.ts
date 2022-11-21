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

export const scrollRandomly = async (page: Page) => {
    // Perform a random scroll on the Y axis, can
    // be called at regular intervals to surface content on
    // pages

    try {
        // set a screen position to scroll from
        const xloc = randrange(50, 100);
        const yloc = randrange(50, 100);
        // CNN is about 10000 pixels long
        // 10000 pixels in 60 seconds, expected value
        // 167 pixels per second?
        const ydelta = randrange(133, 200);
        // puppeteer provides current mouse position to wheel mouse event
        await page.mouse.move(xloc, yloc);
        await page.mouse.wheel({ deltaY: ydelta });
        await delay(500);
    } catch (e) {
        console.log(e);
    }
}

function randrange(low: number, high: number): number {
    return Math.random() * (high - low) + low;
}
